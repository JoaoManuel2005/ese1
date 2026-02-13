#!/usr/bin/env python3
"""
SharePoint Phase 1 Parser Test Suite

Notes for teammates:
- Defaults:
  - pac-workspace/solution.zip
  - pac-workspace/extracted
- No Microsoft login required.
- Avoid emojis to keep Windows encoding safe (set PYTHONUTF8=1 if you add any).
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Add rag_backend to path
sys.path.insert(0, str(Path(__file__).parent / "rag_backend"))

from pac_parser import PacParser, DataverseParser  # noqa: E402
from sharepoint_analyzer import analyze_sharepoint, SHAREPOINT_API_ID  # noqa: E402


DEFAULT_ZIP = "pac-workspace/solution.zip"
DEFAULT_EXTRACT = "pac-workspace/extracted"


def _print_header(title: str) -> None:
    print("=" * 60)
    print(title)
    print("=" * 60)


def _collect_site_urls(sp: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    for app in sp.get("canvas_apps", []):
        if isinstance(app, dict):
            urls.extend(app.get("site_urls", []))
    for src in sp.get("knowledge_sources", []):
        if isinstance(src, dict):
            urls.append(src.get("siteUrl", ""))
            urls.append(src.get("webUrl", ""))
    for tgt in sp.get("targets", []):
        if isinstance(tgt, dict):
            urls.append(tgt.get("siteUrl", ""))
            urls.append(tgt.get("webUrl", ""))
    return sorted({u for u in urls if u})


def _count_sharepoint_envvars(sp: Dict[str, Any]) -> int:
    count = 0
    for ev in sp.get("environment_variables", []):
        if SHAREPOINT_API_ID in (ev.get("apipid") or "").lower():
            count += 1
    return count


def _summarize(sp: Dict[str, Any]) -> Dict[str, Any]:
    site_urls = _collect_site_urls(sp)
    return {
        "env_vars_sharepoint": _count_sharepoint_envvars(sp),
        "flows_sharepoint": len(sp.get("flows", [])),
        "canvas_apps_sharepoint": len(sp.get("canvas_apps", [])),
        "knowledge_sources_sharepoint": len(sp.get("knowledge_sources", [])),
        "targets_count": len(sp.get("targets", [])),
        "site_urls_count": len(site_urls),
        "site_urls": site_urls[:3],
    }


def _print_summary(label: str, result: Dict[str, Any]) -> None:
    sp = result.get("analysis", {}).get("sharepoint", {})
    summary = _summarize(sp)
    print(f"\nSummary: {label}")
    print(f"  used: {sp.get('used')}")
    print(f"  env_vars_sharepoint: {summary['env_vars_sharepoint']}")
    print(f"  flows_sharepoint: {summary['flows_sharepoint']}")
    print(f"  canvas_apps_sharepoint: {summary['canvas_apps_sharepoint']}")
    print(f"  knowledge_sources_sharepoint: {summary['knowledge_sources_sharepoint']}")
    print(f"  targets_count: {summary['targets_count']}")
    print(f"  site_urls_count: {summary['site_urls_count']}")
    if summary["site_urls"]:
        print("  sample_site_urls:")
        for url in summary["site_urls"]:
            print(f"    - {url}")


def _validate_result(
    result: Dict[str, Any],
    require_sharepoint: bool,
    require_site_urls: bool,
) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    sp = result.get("analysis", {}).get("sharepoint", {})
    summary = _summarize(sp)

    if require_sharepoint:
        if sp.get("used") is not True:
            errors.append("sharepoint.used is not True")
        if summary["env_vars_sharepoint"] < 1:
            errors.append("no SharePoint environment variables detected")
        if summary["flows_sharepoint"] < 1:
            errors.append("no SharePoint flows detected")
        if require_site_urls and summary["site_urls_count"] < 1:
            errors.append("no SharePoint site URLs detected in canvas apps or knowledge sources")
        if summary["targets_count"] < 1:
            errors.append("no sharepoint targets found")
        else:
            if not any(t.get("siteUrl") or t.get("env_var_name") for t in sp.get("targets", [])):
                errors.append("targets missing siteUrl or env_var_name")
    else:
        if sp.get("analysis_missing"):
            errors.append("sharepoint analysis missing")

    return (len(errors) == 0), errors


def _pre_scan_sharepoint_signals(extract_dir: Path) -> Tuple[bool, bool]:
    patterns = ("shared_sharepointonline", ".sharepoint.com")
    sharepoint_found = False
    site_url_found = False
    text_exts = {".xml", ".json", ".txt", ".yaml", ".yml"}
    for sub in ("environmentvariabledefinitions", "EnvironmentVariableDefinitions", "Workflows", "CanvasApps", "canvasapps"):
        root = extract_dir / sub
        if not root.exists():
            continue
        for file in root.rglob("*"):
            if not file.is_file():
                continue
            if file.suffix.lower() not in text_exts:
                continue
            try:
                data = file.read_bytes()[:200_000].lower()
            except OSError:
                continue
            if b"shared_sharepointonline" in data:
                sharepoint_found = True
            if b".sharepoint.com" in data:
                sharepoint_found = True
                site_url_found = True
            if sharepoint_found and site_url_found:
                return True, True
    return sharepoint_found, site_url_found


def _run_from_zip(zip_path: str) -> Tuple[Dict[str, Any], bool, bool]:
    parser = PacParser()
    with tempfile.TemporaryDirectory() as temp_dir:
        result = parser.parse_solution(zip_path, temp_dir)
        extract_dir = Path(temp_dir) / "extracted"
        expect_sharepoint, expect_site_urls = _pre_scan_sharepoint_signals(extract_dir)
        return result, expect_sharepoint, expect_site_urls


def _run_from_extract(extract_dir: str) -> Tuple[Dict[str, Any], bool, bool]:
    parser = DataverseParser(extract_dir, verbose=False)
    result = parser.parse_all(sections=["artifacts", "automation"])
    analyze_sharepoint(Path(extract_dir), result)
    expect_sharepoint, expect_site_urls = _pre_scan_sharepoint_signals(Path(extract_dir))
    return result, expect_sharepoint, expect_site_urls


def _build_synthetic_fixture(root: Path) -> None:
    env_dir = root / "environmentvariabledefinitions" / "sp_env"
    env_dir.mkdir(parents=True, exist_ok=True)
    env_xml = """<environmentvariabledefinition>
  <schemaname>spSite</schemaname>
  <displayname><label>SharePoint Site</label></displayname>
  <apipid>shared_sharepointonline</apipid>
  <parameterkey>/dataset</parameterkey>
  <isrequired>1</isrequired>
  <issecret>0</issecret>
  <type>text</type>
  <introducedversion>1.0.0.0</introducedversion>
</environmentvariabledefinition>
"""
    (env_dir / "environmentvariabledefinition.xml").write_text(env_xml, encoding="utf-8")

    wf_dir = root / "Workflows"
    wf_dir.mkdir(parents=True, exist_ok=True)
    flow_payload = {
        "name": "flow-123",
        "properties": {
            "displayName": "SharePoint Flow",
            "connectionReferences": {
                "shared_sharepointonline": {
                    "id": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
                    "displayName": "SharePoint",
                }
            },
            "definition": {
                "triggers": {},
                "actions": {
                    "Get_items": {
                        "type": "OpenApiConnection",
                        "inputs": {
                            "host": {
                                "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"
                            }
                        },
                    }
                },
            },
        },
    }
    (wf_dir / "Flow1.json").write_text(json.dumps(flow_payload), encoding="utf-8")

    ca_dir = root / "CanvasApps" / "app1"
    ca_dir.mkdir(parents=True, exist_ok=True)
    meta = """<CanvasApp>
  <AppSettings>{"dataSources":[{"name":"ReplyList"}]}</AppSettings>
  <ConnectionReferences>{"shared_sharepointonline":{"id":"/providers/Microsoft.PowerApps/apis/shared_sharepointonline","dataSets":{"https://example.sharepoint.com/sites/TestSite":{"datasetOverride":{"environmentVariableName":"wmreply_Test_SP_Site"},"dataSources":[{"name":"ReplyList","tableNameOverride":{"environmentVariableName":"wmreply_Test_SP_List"}}]}}}}</ConnectionReferences>
  <DatasetOverride>{"environmentVariableName":"SP_SITE"}</DatasetOverride>
  <SiteUrl>https://example.sharepoint.com/sites/Reply</SiteUrl>
  <DataSource name="ReplyList" />
</CanvasApp>
"""
    (ca_dir / "app1.meta.xml").write_text(meta, encoding="utf-8")


def _run_synthetic() -> Dict[str, Any]:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        _build_synthetic_fixture(root)
        result = {"name": "Synthetic Solution", "version": "1.0.0", "publisher": "Synthetic", "components": []}
        analyze_sharepoint(root, result)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="SharePoint Phase 1 Parser Test Suite")
    parser.add_argument("--zip", type=str, help="Path to solution.zip file")
    parser.add_argument("--extract-dir", type=str, help="Path to extracted solution directory")
    parser.add_argument(
        "--mode",
        choices=["synthetic", "extracted", "zip", "both"],
        default="both",
        help="Which inputs to test (default: both)",
    )

    args = parser.parse_args()

    _print_header("SHAREPOINT PARSER TEST SUITE")
    all_passed = True

    ran_any = False

    if args.mode in ("zip", "both"):
        zip_path = args.zip or DEFAULT_ZIP
        if os.path.exists(zip_path):
            ran_any = True
            _print_header("Testing PacParser on ZIP")
            try:
                result, expect_sharepoint, expect_site_urls = _run_from_zip(zip_path)
                print(f"ZIP: {zip_path}")
                print(f"Solution: {result.get('name', 'N/A')} {result.get('version', '')}".strip())
                _print_summary("zip", result)
                passed, errors = _validate_result(
                    result,
                    require_sharepoint=expect_sharepoint,
                    require_site_urls=expect_site_urls,
                )
                if passed:
                    print("Result: PASS")
                else:
                    print("Result: FAIL")
                    for err in errors:
                        print(f"  - {err}")
                    all_passed = False
            except Exception as exc:
                print(f"Result: FAIL (exception: {exc})")
                all_passed = False
        else:
            print(f"ZIP not found: {zip_path}")

    if args.mode in ("extracted", "both"):
        extract_dir = args.extract_dir or DEFAULT_EXTRACT
        if os.path.exists(extract_dir):
            ran_any = True
            _print_header("Testing DataverseParser on extracted folder")
            try:
                result, expect_sharepoint, expect_site_urls = _run_from_extract(extract_dir)
                solution = result.get("solution", {})
                print(f"Extracted: {extract_dir}")
                if solution:
                    print(f"Solution: {solution.get('name', 'N/A')} {solution.get('version', '')}".strip())
                _print_summary("extracted", result)
                passed, errors = _validate_result(
                    result,
                    require_sharepoint=expect_sharepoint,
                    require_site_urls=expect_site_urls,
                )
                if passed:
                    print("Result: PASS")
                else:
                    print("Result: FAIL")
                    for err in errors:
                        print(f"  - {err}")
                    all_passed = False
            except Exception as exc:
                print(f"Result: FAIL (exception: {exc})")
                all_passed = False
        else:
            print(f"Extracted folder not found: {extract_dir}")

    if args.mode in ("synthetic", "both") or not ran_any:
        ran_any = True
        _print_header("Testing synthetic fixtures")
        try:
            result = _run_synthetic()
            print("Solution: Synthetic Solution 1.0.0")
            _print_summary("synthetic", result)
            passed, errors = _validate_result(result, require_sharepoint=True, require_site_urls=True)
            if passed:
                print("Result: PASS")
            else:
                print("Result: FAIL")
                for err in errors:
                    print(f"  - {err}")
                all_passed = False
        except Exception as exc:
            print(f"Result: FAIL (exception: {exc})")
            all_passed = False

    if all_passed:
        _print_header("ALL TESTS PASSED")
        return 0

    _print_header("TESTS FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
