import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


SHAREPOINT_API_ID = "shared_sharepointonline"
MAX_CANVAS_SCAN_BYTES = 3 * 1024 * 1024


def analyze_sharepoint(extract_dir: Path, parsed_result: Dict[str, Any]) -> Dict[str, Any]:
    extract_dir = Path(extract_dir)

    analysis = parsed_result.setdefault("analysis", {})
    sp = analysis.setdefault("sharepoint", {})
    sp.setdefault("used", False)
    sp.setdefault("environment_variables", [])
    sp.setdefault("flows", [])
    sp.setdefault("canvas_apps", [])
    sp.setdefault("knowledge_sources", [])
    sp.setdefault("targets", [])
    sp.setdefault("errors", [])

    errors: List[str] = sp["errors"]

    folder_map = _map_root_folders(extract_dir)

    env_vars = _parse_environment_variables(folder_map, errors)
    sp["environment_variables"] = env_vars

    flows, flow_targets = _parse_flows(folder_map, parsed_result, errors)
    sp["flows"] = flows

    canvas_apps = _scan_canvas_apps(folder_map, errors)
    sp["canvas_apps"] = canvas_apps

    knowledge_sources, knowledge_targets = _extract_knowledge_sources(parsed_result)
    sp["knowledge_sources"] = knowledge_sources

    targets = []
    for ev in env_vars:
        if _is_sharepoint_envvar(ev):
            env_var_name = ev.get("schemaname") or ev.get("displayname") or ""
            if env_var_name:
                targets.append({
                    "source": "envvar",
                    "env_var_name": env_var_name,
                })

    targets.extend(flow_targets)
    targets.extend(knowledge_targets)

    for app in canvas_apps:
        if not app:
            continue
        target: Dict[str, Any] = {"source": "canvasapp"}
        if app.get("app_name"):
            target["app_name"] = app.get("app_name")
        if app.get("app_id"):
            target["app_id"] = app.get("app_id")
        site_urls = app.get("site_urls") or []
        app_env_vars = app.get("env_var_names") or []
        if site_urls:
            target["siteUrl"] = site_urls[0]
        if app_env_vars:
            target["env_var_name"] = app_env_vars[0]
        if "siteUrl" in target or "env_var_name" in target:
            targets.append(target)

    # Phase 2 note: use targets with siteUrl/siteId/driveId/itemId to seed Graph crawling after auth.
    sp["targets"] = targets

    if any(_is_sharepoint_envvar(ev) for ev in env_vars) or flows or canvas_apps or knowledge_sources:
        sp["used"] = True

    return parsed_result


def _map_root_folders(extract_dir: Path) -> Dict[str, Path]:
    mapping: Dict[str, Path] = {}
    if not extract_dir.exists():
        return mapping
    for item in extract_dir.iterdir():
        if item.is_dir():
            mapping[item.name.lower()] = item
    return mapping


def _get_folder(mapping: Dict[str, Path], name: str) -> Optional[Path]:
    return mapping.get(name.lower())


def _parse_environment_variables(folder_map: Dict[str, Path], errors: List[str]) -> List[Dict[str, Any]]:
    ev_dir = _get_folder(folder_map, "environmentvariabledefinitions")
    if not ev_dir:
        ev_dir = _get_folder(folder_map, "EnvironmentVariableDefinitions")
    if not ev_dir:
        return []

    results: List[Dict[str, Any]] = []

    for item in ev_dir.iterdir():
        if item.is_dir():
            ev_info: Dict[str, Any] = _empty_envvar()
            for f in item.rglob("*.xml"):
                parsed = _parse_env_var_xml(f, errors)
                if parsed:
                    _merge_envvar(ev_info, parsed)
            if not ev_info.get("schemaname"):
                ev_info["schemaname"] = item.name
            if any(ev_info.values()):
                results.append(ev_info)
        elif item.is_file() and item.suffix.lower() == ".xml":
            parsed = _parse_env_var_xml(item, errors)
            if parsed and any(parsed.values()):
                results.append(parsed)

    return results


def _empty_envvar() -> Dict[str, Any]:
    return {
        "schemaname": "",
        "displayname": "",
        "apipid": "",
        "parameterkey": "",
        "isrequired": "",
        "issecret": "",
        "type": "",
        "introducedversion": "",
    }


def _merge_envvar(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key, value in source.items():
        if value and not target.get(key):
            target[key] = value


def _parse_env_var_xml(path: Path, errors: List[str]) -> Optional[Dict[str, Any]]:
    try:
        tree = ET.parse(str(path))
        root = tree.getroot()
    except ET.ParseError as exc:
        errors.append(f"envvar_xml_parse_error:{path.name}:{exc}")
        return None

    result = _empty_envvar()
    result["schemaname"] = _find_attr_value(root, "schemaname") or _find_text(root, "schemaname")
    result["displayname"] = _find_display_name(root)
    result["apipid"] = _find_text(root, "apipid") or _find_text(root, "apiid")
    result["parameterkey"] = _find_text(root, "parameterkey")
    result["isrequired"] = _find_text(root, "isrequired")
    result["issecret"] = _find_text(root, "issecret")
    result["type"] = _find_text(root, "type")
    result["introducedversion"] = _find_text(root, "introducedversion")
    return result


def _find_text(root: ET.Element, tag_name: str) -> str:
    target = tag_name.lower()
    for elem in root.iter():
        local = _local_name(elem.tag)
        if local == target and elem.text and elem.text.strip():
            return elem.text.strip()
    return ""


def _find_display_name(root: ET.Element) -> str:
    for elem in root.iter():
        local = _local_name(elem.tag)
        if local == "displayname":
            if elem.text and elem.text.strip():
                return elem.text.strip()
            for sub in elem.iter():
                sub_local = _local_name(sub.tag)
                if sub_local == "label" and sub.text and sub.text.strip():
                    return sub.text.strip()
                if sub_local == "label":
                    desc = sub.attrib.get("description") or sub.attrib.get("Description")
                    if desc:
                        return desc.strip()
    return ""


def _local_name(tag: str) -> str:
    if "}" in tag:
        tag = tag.split("}", 1)[1]
    return tag.lower()


def _is_sharepoint_envvar(env: Dict[str, Any]) -> bool:
    if not isinstance(env, dict):
        return False
    api_value = env.get("apipid") or env.get("apiid") or ""
    return SHAREPOINT_API_ID in api_value.lower()


def _find_attr_value(root: ET.Element, attr_name: str) -> str:
    target = attr_name.lower()
    for key, value in root.attrib.items():
        if key.lower() == target and value:
            return value.strip()
    return ""


def _parse_flows(
    folder_map: Dict[str, Path],
    parsed_result: Dict[str, Any],
    errors: List[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    wf_dir = _get_folder(folder_map, "Workflows")
    if not wf_dir:
        return [], []

    connector_index = _build_flow_connector_index(parsed_result)
    flows: List[Dict[str, Any]] = []
    targets: List[Dict[str, Any]] = []

    for item in wf_dir.rglob("*.json"):
        if item.name.lower().endswith(".data.json"):
            continue
        if item.name.lower().endswith(".data.xml"):
            continue
        source_file = str(item.relative_to(wf_dir.parent))
        parsed = _parse_flow_json(item, source_file, connector_index, errors)
        if not parsed:
            continue
        flow, site_urls = parsed
        if flow.get("uses_sharepoint"):
            flows.append(flow)
            target = {"source": "flow", "flow_name": flow.get("flow_name", "")}
            if site_urls:
                target["siteUrl"] = site_urls[0]
            targets.append(target)

    return flows, targets


def _build_flow_connector_index(parsed_result: Dict[str, Any]) -> Dict[str, List[str]]:
    index: Dict[str, List[str]] = {}
    flows = parsed_result.get("automation", {}).get("cloud_flows", [])
    for flow in flows:
        connectors = flow.get("connectors") or []
        if not connectors:
            continue
        connector_names = []
        for conn in connectors:
            if isinstance(conn, dict):
                connector_names.append(conn.get("api") or conn.get("name") or conn.get("key") or "")
            elif isinstance(conn, str):
                connector_names.append(conn)
        connector_names = [c for c in connector_names if c]
        if not connector_names:
            continue
        for key in (flow.get("flow_id"), flow.get("display_name"), flow.get("source_file")):
            if key:
                index[key] = connector_names
    return index


def _parse_flow_json(
    path: Path,
    source_file: str,
    connector_index: Dict[str, List[str]],
    errors: List[str],
) -> Optional[Tuple[Dict[str, Any], List[str]]]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        errors.append(f"flow_json_parse_error:{path.name}:{exc}")
        return None

    props = data.get("properties", data)
    definition = props.get("definition", {})
    if not definition and "triggers" in data:
        definition = data
    if not definition and "triggers" in props:
        definition = props

    flow_id = data.get("name") or props.get("name") or ""
    flow_name = props.get("displayName") or data.get("displayName") or path.stem

    connectors_used = _connectors_from_index(connector_index, flow_id, flow_name, source_file)
    if not connectors_used:
        connectors_used = _connectors_from_references(props.get("connectionReferences", {}))

    sharepoint_actions: Set[str] = set()
    sharepoint_sites: Set[str] = set()

    uses_sharepoint = False

    for ref in props.get("connectionReferences", {}).values():
        api_id = _get_ref_api_id(ref)
        if SHAREPOINT_API_ID in api_id.lower():
            uses_sharepoint = True
            if not any(SHAREPOINT_API_ID in c.lower() for c in connectors_used):
                connectors_used.append(SHAREPOINT_API_ID)

    triggers = definition.get("triggers", {})
    if isinstance(triggers, dict):
        for name, trig in triggers.items():
            api_id = _get_host_api_id(trig)
            if SHAREPOINT_API_ID in api_id.lower():
                sharepoint_actions.add(name)
                uses_sharepoint = True
            _extract_site_urls(trig, sharepoint_sites)

    parameters = definition.get("parameters", {})
    _extract_site_urls(parameters, sharepoint_sites)

    actions = definition.get("actions", {})
    _walk_actions_for_sharepoint(actions, sharepoint_actions, sharepoint_sites)
    if sharepoint_actions:
        uses_sharepoint = True
        if not any(SHAREPOINT_API_ID in c.lower() for c in connectors_used):
            connectors_used.append(SHAREPOINT_API_ID)

    if any(SHAREPOINT_API_ID in c.lower() for c in connectors_used):
        uses_sharepoint = True

    connectors_used = _unique_sorted(connectors_used)

    flow_entry = {
        "flow_id": flow_id,
        "flow_name": flow_name,
        "uses_sharepoint": uses_sharepoint,
        "connectors_used": connectors_used,
        "sharepoint_actions_used": sorted(sharepoint_actions),
    }

    return flow_entry, sorted(sharepoint_sites)


def _connectors_from_index(
    connector_index: Dict[str, List[str]],
    flow_id: str,
    flow_name: str,
    source_file: str,
) -> List[str]:
    for key in (flow_id, flow_name, source_file):
        if key in connector_index:
            return list(connector_index[key])
    return []


def _connectors_from_references(refs: Dict[str, Any]) -> List[str]:
    connectors: List[str] = []
    for ref in refs.values():
        api_id = _get_ref_api_id(ref)
        if api_id:
            connectors.append(_short_api_name(api_id))
    return _unique_sorted(connectors)


def _short_api_name(api_id: str) -> str:
    if "/" in api_id:
        return api_id.rsplit("/", 1)[-1]
    return api_id


def _get_ref_api_id(ref: Any) -> str:
    if isinstance(ref, dict):
        return ref.get("id") or ref.get("apiId") or ""
    return ""


def _get_host_api_id(obj: Any) -> str:
    if not isinstance(obj, dict):
        return ""
    inputs = obj.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""
    host = inputs.get("host", {})
    if not isinstance(host, dict):
        return ""
    return host.get("apiId", "") or ""


def _walk_actions_for_sharepoint(
    actions: Any,
    sharepoint_actions: Set[str],
    sharepoint_sites: Set[str],
) -> None:
    if not isinstance(actions, dict):
        return

    for name, action in actions.items():
        if not isinstance(action, dict):
            continue

        api_id = _get_host_api_id(action)
        if SHAREPOINT_API_ID in api_id.lower():
            sharepoint_actions.add(name)
        _extract_site_urls(action, sharepoint_sites)

        nested_actions = action.get("actions", {})
        _walk_actions_for_sharepoint(nested_actions, sharepoint_actions, sharepoint_sites)

        cases = action.get("cases", {})
        if isinstance(cases, dict):
            for case_value in cases.values():
                _walk_actions_for_sharepoint(case_value.get("actions", {}), sharepoint_actions, sharepoint_sites)

        if "else" in action:
            _walk_actions_for_sharepoint(action.get("else", {}).get("actions", {}), sharepoint_actions, sharepoint_sites)


def _extract_site_urls(obj: Any, site_urls: Set[str]) -> None:
    if isinstance(obj, dict):
        for value in obj.values():
            _extract_site_urls(value, site_urls)
    elif isinstance(obj, list):
        for value in obj:
            _extract_site_urls(value, site_urls)
    elif isinstance(obj, str):
        lowered = obj.lower()
        if ".sharepoint.com" in lowered and not obj.strip().startswith("@"):
            site_urls.add(obj.strip())


def _unique_sorted(items: Iterable[str]) -> List[str]:
    seen: Set[str] = set()
    result: List[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _scan_canvas_apps(folder_map: Dict[str, Path], errors: List[str]) -> List[Dict[str, Any]]:
    ca_dir = _get_folder(folder_map, "CanvasApps")
    if not ca_dir:
        ca_dir = _get_folder(folder_map, "canvasapps")
    if not ca_dir:
        return []

    results: List[Dict[str, Any]] = []

    for item in ca_dir.iterdir():
        if item.is_dir():
            signals = _scan_canvas_app_folder(item, errors)
        elif item.is_file():
            signals = _scan_canvas_app_file(item, errors)
        else:
            continue

        if _has_canvas_signals(signals):
            app_name, app_id = _infer_app_name_id(item)
            results.append({
                "app_name": app_name,
                "app_id": app_id,
                "evidence": signals["evidence"],
                "site_urls": signals["site_urls"],
                "data_sources": signals["data_sources"],
                "env_var_names": signals["env_var_names"],
            })

    return results


def _scan_canvas_app_folder(folder: Path, errors: List[str]) -> Dict[str, List[str]]:
    signals = _empty_canvas_signals()
    for f in folder.rglob("*"):
        if not f.is_file():
            continue
        current = _scan_canvas_app_file(f, errors)
        _merge_canvas_signals(signals, current)
    return signals


def _scan_canvas_app_file(path: Path, errors: List[str]) -> Dict[str, List[str]]:
    try:
        text = _read_limited_text(path, MAX_CANVAS_SCAN_BYTES)
    except OSError as exc:
        errors.append(f"canvas_scan_error:{path.name}:{exc}")
        return _empty_canvas_signals()

    signals = _extract_canvas_signals(text)
    if path.name.lower().endswith(".meta.xml"):
        xml_signals = _extract_canvas_meta_signals(path, errors)
        _merge_canvas_signals(signals, xml_signals)
    return signals


def _empty_canvas_signals() -> Dict[str, List[str]]:
    return {
        "evidence": [],
        "site_urls": [],
        "data_sources": [],
        "env_var_names": [],
    }


def _merge_canvas_signals(target: Dict[str, List[str]], source: Dict[str, List[str]]) -> None:
    for key in target.keys():
        target[key] = _unique_sorted(list(target.get(key, [])) + list(source.get(key, [])))


def _has_canvas_signals(signals: Dict[str, List[str]]) -> bool:
    return any(signals.get(key) for key in ("evidence", "site_urls", "data_sources", "env_var_names"))


def _extract_canvas_signals(text: str) -> Dict[str, List[str]]:
    signals = _empty_canvas_signals()
    lowered = text.lower()

    if "shared_sharepointonline" in lowered:
        signals["evidence"].append("shared_sharepointonline")
    if ".sharepoint.com" in lowered:
        signals["evidence"].append(".sharepoint.com")
    if "sharepoint" in lowered:
        signals["evidence"].append("sharepoint")

    for match in re.findall(r"https?://[^\"'\\s>]+\\.sharepoint\\.com[^\"'\\s>]*", text, flags=re.IGNORECASE):
        signals["site_urls"].append(match)

    for match in re.findall(r"environmentVariableName\\s*[:=]\\s*\"([^\"]+)\"", text, flags=re.IGNORECASE):
        signals["env_var_names"].append(match)

    for match in re.findall(r"<DataSource[^>]*name=\"([^\"]+)\"", text, flags=re.IGNORECASE):
        signals["data_sources"].append(match)

    for block in re.findall(r"dataSources\\s*[:=]\\s*\\[(.{0,2000})\\]", text, flags=re.IGNORECASE | re.DOTALL):
        for name in re.findall(r"\"name\"\\s*:\\s*\"([^\"]+)\"", block):
            signals["data_sources"].append(name)

    for block in re.findall(r"dataSource\\s*[:=]\\s*\\{(.{0,2000})\\}", text, flags=re.IGNORECASE | re.DOTALL):
        for name in re.findall(r"\"name\"\\s*:\\s*\"([^\"]+)\"", block):
            signals["data_sources"].append(name)

    signals["evidence"] = _unique_sorted(signals["evidence"])
    signals["site_urls"] = _unique_sorted(signals["site_urls"])
    signals["data_sources"] = _unique_sorted(signals["data_sources"])
    signals["env_var_names"] = _unique_sorted(signals["env_var_names"])
    return signals


def _extract_canvas_meta_signals(path: Path, errors: List[str]) -> Dict[str, List[str]]:
    signals = _empty_canvas_signals()
    try:
        tree = ET.parse(str(path))
        root = tree.getroot()
    except ET.ParseError as exc:
        errors.append(f"canvas_meta_xml_parse_error:{path.name}:{exc}")
        return signals

    conn_el = _find_first_element(root, "connectionreferences")
    if conn_el is None:
        return signals

    json_text = "".join(conn_el.itertext()).strip()
    if not json_text:
        return signals

    try:
        refs = json.loads(json_text)
    except json.JSONDecodeError as exc:
        errors.append(f"canvas_meta_json_parse_error:{path.name}:{exc}")
        return signals

    if not isinstance(refs, dict):
        return signals

    for ref in refs.values():
        if not isinstance(ref, dict):
            continue
        api_id = ref.get("id") or ref.get("apiId") or ""
        if SHAREPOINT_API_ID in api_id.lower():
            signals["evidence"].append("shared_sharepointonline")

        datasets = ref.get("dataSets") or ref.get("datasets") or {}
        if isinstance(datasets, dict):
            for dataset_key, dataset_value in datasets.items():
                if isinstance(dataset_key, str) and ".sharepoint.com" in dataset_key.lower():
                    signals["site_urls"].append(dataset_key)
                if isinstance(dataset_value, dict):
                    _extract_dataset_overrides(dataset_value, signals)

        data_sources = ref.get("dataSources") or ref.get("datasources")
        _extract_data_sources(data_sources, signals)

    signals["evidence"] = _unique_sorted(signals["evidence"])
    signals["site_urls"] = _unique_sorted(signals["site_urls"])
    signals["data_sources"] = _unique_sorted(signals["data_sources"])
    signals["env_var_names"] = _unique_sorted(signals["env_var_names"])
    return signals


def _extract_dataset_overrides(dataset_value: Dict[str, Any], signals: Dict[str, List[str]]) -> None:
    override = dataset_value.get("datasetOverride") or {}
    if isinstance(override, dict):
        env_name = override.get("environmentVariableName") or ""
        if env_name:
            signals["env_var_names"].append(env_name)

    data_sources = dataset_value.get("dataSources")
    _extract_data_sources(data_sources, signals)


def _extract_data_sources(data_sources: Any, signals: Dict[str, List[str]]) -> None:
    if isinstance(data_sources, list):
        for ds in data_sources:
            if isinstance(ds, dict):
                _extract_data_source_entry(ds, signals)
    elif isinstance(data_sources, dict):
        for ds in data_sources.values():
            if isinstance(ds, dict):
                _extract_data_source_entry(ds, signals)


def _extract_data_source_entry(entry: Dict[str, Any], signals: Dict[str, List[str]]) -> None:
    name = entry.get("name") or entry.get("tableName") or ""
    if name:
        signals["data_sources"].append(name)
    override = entry.get("tableNameOverride") or {}
    if isinstance(override, dict):
        env_name = override.get("environmentVariableName") or ""
        if env_name:
            signals["env_var_names"].append(env_name)


def _find_first_element(root: ET.Element, local_name: str) -> Optional[ET.Element]:
    target = local_name.lower()
    for elem in root.iter():
        if _local_name(elem.tag) == target:
            return elem
    return None


def _read_limited_text(path: Path, max_bytes: int) -> str:
    with open(path, "rb") as fh:
        data = fh.read(max_bytes)
    return data.decode("utf-8", errors="ignore")


def _infer_app_name_id(path: Path) -> Tuple[str, str]:
    name = path.stem if path.is_file() else path.name
    app_id = name if _looks_like_guid(name) else ""
    return name, app_id


def _looks_like_guid(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value))


def _extract_knowledge_sources(parsed_result: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    knowledge_sources: List[Dict[str, Any]] = []
    targets: List[Dict[str, Any]] = []

    dv_searches = parsed_result.get("artifacts", {}).get("dv_searches", [])
    if not dv_searches:
        return knowledge_sources, targets

    for search in dv_searches:
        for source in search.get("knowledge_sources", []):
            sp = source.get("sharepoint", {}) or {}
            entry = {
                "siteUrl": sp.get("site_url", sp.get("siteUrl", "")) or "",
                "siteId": sp.get("site_id", sp.get("siteId", "")) or "",
                "listId": sp.get("list_id", sp.get("listId", "")) or "",
                "driveId": source.get("drive_id", source.get("driveId", "")) or "",
                "itemId": source.get("item_id", source.get("itemId", "")) or "",
                "webUrl": source.get("web_url", source.get("webUrl", "")) or "",
            }
            if any(entry.values()):
                knowledge_sources.append(entry)
                targets.append({
                    "source": "knowledge_source",
                    "siteUrl": entry.get("siteUrl", ""),
                    "siteId": entry.get("siteId", ""),
                    "listId": entry.get("listId", ""),
                    "driveId": entry.get("driveId", ""),
                    "itemId": entry.get("itemId", ""),
                    "webUrl": entry.get("webUrl", ""),
                })

    return knowledge_sources, targets
