import subprocess
import os
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any, Optional, Set, Tuple 
from datetime import datetime, timezone
import zipfile


DATAVERSE_API_ID = "shared_commondataserviceforapps"
LOGICFLOWS_API_ID = "shared_logicflows"


FLOW_OPERATION_MAP = {        # Mapping of common Power Automate operation types to simplified categories
    "ListRecords": "List", "GetItem": "Get", "GetItems": "List",
    "CreateRecord": "Create", "UpdateRecord": "Update", "DeleteRecord": "Delete",
    "SubsriptionWebhookTrigger": "Trigger", "GetOnUpdatedItems": "Trigger",
    "GetOnNewItems": "Trigger", "PerformBoundAction": "BoundAction",
    "PerformUnboundAction": "UnboundAction",
}


FORM_TYPE_MAP = {     # Mapping of form type codes to human-readable names
    "0": "DASHBOARD", "2": "Main", "5": "Mobile", "6": "Quick View",
    "7": "Quick Create", "10": "Main-Interactive", "11": "Card",
}


WORKFLOW_CATEGORY_MAP ={
    "0": "Classic Workflow", "1": "Dialog", "2": "Businnes Rule",
    "3": "Action", "4": "Business Process Flow", "5": "Cloud Flow",
}


PRIVILEGE_DEPTH_MAP = {
    "1": "User", "2": "Business Unit", "4": "Parent:Child BU", "8": "Organization",
}



class PacParser:
    """Parser for Power Platform solution files using PAC CLI"""
    
    def __init__(self):
        # Defer PAC CLI detection until first use
        self.pac_path = None
        self.pac_checked = False
        self._pac_available = None
    
    @property
    def pac_available(self):
        """Check if PAC CLI is available (with lazy loading)"""
        if not self.pac_checked:
            self.pac_path = self._find_pac_cli()
            self._pac_available = self.pac_path is not None
            self.pac_checked = True
        return self._pac_available
    
    def _find_pac_cli(self) -> str:
        """Find PAC CLI executable"""
        # Check if we can access PAC CLI via Docker container
        # Try multiple times with increasing timeout due to QEMU emulation overhead
        import time
        
        for attempt in range(2):
            try:
                timeout_val = 60 if attempt == 0 else 90
                print(f"Checking PAC CLI via Docker (attempt {attempt + 1}, timeout={timeout_val}s)...")
                result = subprocess.run(
                    ["docker", "exec", "pac-cli", "pac", "help"],
                    capture_output=True,
                    text=True,
                    timeout=timeout_val
                )
                if result.returncode == 0:
                    print("✓ Found PAC CLI in Docker container 'pac-cli'")
                    return "docker-container"
                else:
                    print(f"Docker exec failed with return code {result.returncode}: {result.stderr}")
                    if attempt == 0:
                        time.sleep(5)  # Wait before retry
                        continue
            except subprocess.TimeoutExpired:
                print(f"Docker exec to pac-cli timed out after {timeout_val}s (attempt {attempt + 1})")
                if attempt == 0:
                    print("Retrying with longer timeout...")
                    time.sleep(5)
                    continue
            except FileNotFoundError:
                print("Docker command not found")
                break
            except Exception as e:
                print(f"Error checking Docker PAC CLI: {type(e).__name__}: {e}")
                break
        
        # Fallback: Check for local PAC CLI installation
        possible_paths = [
            os.path.expanduser("~/.dotnet/tools/pac"),
            "pac",  # In PATH
            "/root/.dotnet/tools/pac",
        ]
        
        for pac_path in possible_paths:
            expanded_path = os.path.expanduser(pac_path) if pac_path.startswith("~") else pac_path
            if os.path.exists(expanded_path) and os.access(expanded_path, os.X_OK):
                print(f"✓ Found local PAC CLI at: {expanded_path}")
                return expanded_path
        
        print("Warning: PAC CLI not found. Using fallback XML parsing.")
        return None
    
    def parse_solution(self, zip_path: str, temp_dir: str) -> Dict[str, Any]:
        """Parse a Power Platform solution zip file"""
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        
        # Check for PAC CLI on first use
        if not self.pac_checked:
            self.pac_path = self._find_pac_cli()
            self._pac_available = self.pac_path is not None
            self.pac_checked = True
        
        if self._pac_available:
            return self._parse_with_pac_cli(zip_path, extract_dir)
        else:
            return self._parse_with_fallback(zip_path, extract_dir)
    
    def _parse_with_pac_cli(self, zip_path: str, extract_dir: str) -> Dict[str, Any]:
        """Use PAC CLI to unpack and parse solution"""
        try:
            if self.pac_path == "docker-container":
                # Copy zip file to pac-cli container, unpack, then copy back
                container_zip = "/pac-workspace/solution.zip"
                container_extract = "/pac-workspace/extracted"
                
                # Copy zip file to container
                subprocess.run(
                    ["docker", "cp", zip_path, f"pac-cli:{container_zip}"],
                    check=True,
                    capture_output=True
                )
                
                # Run PAC CLI unpack command in container
                result = subprocess.run(
                    ["docker", "exec", "pac-cli", "pac", "solution", "unpack", 
                     "--zipfile", container_zip, "--folder", container_extract],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                
                if result.returncode != 0:
                    raise Exception(f"PAC CLI error: {result.stderr}")
                
                # Copy extracted files back to host
                subprocess.run(
                    ["docker", "cp", f"pac-cli:{container_extract}/.", extract_dir],
                    check=True,
                    capture_output=True
                )
                
            else:
                # Use local PAC CLI
                result = subprocess.run(
                    [self.pac_path, "solution", "unpack", "--zipfile", zip_path, "--folder", extract_dir],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                
                if result.returncode != 0:
                    raise Exception(f"PAC CLI error: {result.stderr}")
            
            return self._parse_unpacked_solution(extract_dir)
            
        except subprocess.TimeoutExpired:
            raise Exception("PAC CLI timed out")
        except Exception as e:
            print(f"PAC CLI failed: {e}, using fallback")
            return self._parse_with_fallback(zip_path, extract_dir)
    
    def _parse_with_fallback(self, zip_path: str, extract_dir: str) -> Dict[str, Any]:
        """Fallback: manually extract and parse solution XML"""
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
        
        return self._parse_unpacked_solution(extract_dir)
    
    def _parse_unpacked_solution(self, extract_dir: str) -> Dict[str, Any]:
        """Parse an unpacked solution directory with enhanced DataverseParser"""
        solution_data = {
            "name": "Unknown Solution",
            "version": "1.0.0",
            "publisher": "Unknown",
            "components": []
        }
        
        # Debug: list what's in extract_dir
        print(f"[PAC Parser] Extracted directory: {extract_dir}")
        if os.path.exists(extract_dir):
            print(f"[PAC Parser] Contents: {os.listdir(extract_dir)}")
        
        # Parse solution.xml - try multiple locations (PAC CLI may create different structure)
        solution_xml_paths = [
            os.path.join(extract_dir, "solution.xml"),
            os.path.join(extract_dir, "Other", "solution.xml"),
            os.path.join(extract_dir, "src", "solution.xml"),
        ]
        
        # Also search for solution.xml recursively
        for root, dirs, files in os.walk(extract_dir):
            if "solution.xml" in files:
                solution_xml_paths.append(os.path.join(root, "solution.xml"))
        
        print(f"[PAC Parser] Searching for solution.xml in {len(solution_xml_paths)} locations")
        for solution_xml_path in solution_xml_paths:
            if os.path.exists(solution_xml_path):
                print(f"[PAC Parser] Found solution.xml at: {solution_xml_path}")
                parsed = self._parse_solution_xml(solution_xml_path)
                print(f"[PAC Parser] Parsed solution: name={parsed.get('name')}, publisher={parsed.get('publisher')}")
                if parsed.get("name") and parsed.get("name") != "Unknown":
                    solution_data.update(parsed)
                    break
        
        # Parse all component types (basic)
        self._parse_directory(extract_dir, "Workflows", "flow", solution_data)
        self._parse_directory(extract_dir, "CanvasApps", "canvasapp", solution_data)
        self._parse_directory(extract_dir, "Entities", "entity", solution_data)
        self._parse_directory(extract_dir, "WebResources", "webresource", solution_data)
        self._parse_directory(extract_dir, "PluginAssemblies", "plugin", solution_data)
        self._parse_directory(extract_dir, "Reports", "report", solution_data)
        
        # ✨ NEW: Use DataverseParser for comprehensive parsing
        print(f"[PAC Parser] Running DataverseParser for enhanced data...")
        try:
            dv_parser = DataverseParser(extract_dir, verbose=False)
            enhanced_data = dv_parser.parse_all()
            
            # Merge enhanced data into solution_data
            solution_data["enhanced"] = {
                "metadata": enhanced_data.get("metadata", {}),
                "artifacts": enhanced_data.get("artifacts", {}),
                "automation": enhanced_data.get("automation", {}),
                "security": enhanced_data.get("security", {}),
                "summary": enhanced_data.get("summary", {}),
            }
            print(f"[PAC Parser] Enhanced data added: {len(enhanced_data.get('artifacts', {}).get('dv_searches', []))} knowledge sources, "
                  f"{len(enhanced_data.get('automation', {}).get('cloud_flows', []))} flows")
        except Exception as e:
            print(f"[PAC Parser] DataverseParser failed: {e}, continuing with basic data")
            solution_data["enhanced"] = None
        
        return solution_data
    
    def _parse_solution_xml(self, xml_path: str) -> Dict[str, str]:
        """Parse solution.xml for basic solution info"""
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
            
            # Look for SolutionManifest structure
            name = None
            version = None
            publisher = None
            
            # Try to find UniqueName under SolutionManifest
            for elem in root.iter():
                tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag  # Remove namespace
                
                if tag == 'SolutionManifest':
                    for child in elem:
                        child_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                        if child_tag == 'UniqueName' and child.text:
                            name = child.text.strip()
                        elif child_tag == 'Version' and child.text:
                            version = child.text.strip()
                        elif child_tag == 'Publisher':
                            # Look for UniqueName inside Publisher
                            for pub_child in child:
                                pub_tag = pub_child.tag.split('}')[-1] if '}' in pub_child.tag else pub_child.tag
                                if pub_tag == 'UniqueName' and pub_child.text:
                                    publisher = pub_child.text.strip()
                                    break
            
            return {
                "name": name or "Unknown",
                "version": version or "1.0.0",
                "publisher": publisher or "Unknown"
            }
        except Exception as e:
            print(f"Error parsing solution.xml: {e}")
            return {"name": "Unknown", "version": "1.0.0", "publisher": "Unknown"}
    
    def _find_text(self, root, tag_name: str) -> str:
        """Find text in XML regardless of namespace"""
        for elem in root.iter():
            if elem.tag.endswith(tag_name) and elem.text:
                return elem.text.strip()
        return None
    
    def _find_publisher(self, root) -> str:
        """Find publisher name in XML"""
        for elem in root.iter():
            if elem.tag.endswith("Publisher"):
                for child in elem.iter():
                    if child.tag.endswith("UniqueName") and child.text:
                        return child.text.strip()
        return None
    
    def _parse_directory(self, extract_dir: str, dir_name: str, comp_type: str, solution_data: Dict):
        """Parse a component directory"""
        dir_path = os.path.join(extract_dir, dir_name)
        if not os.path.exists(dir_path):
            return
        
        for item in os.listdir(dir_path):
            item_path = os.path.join(dir_path, item)
            component = self._parse_component(item, item_path, comp_type)
            if component:
                solution_data["components"].append(component)
    
    def _parse_component(self, name: str, path: str, comp_type: str) -> Dict[str, Any]:
        """Parse a single component"""
        clean_name = name.replace('.json', '').replace('.xml', '')
        
        component = {
            "name": clean_name,
            "type": comp_type,
            "description": self._get_description(comp_type, clean_name),
            "metadata": {}
        }
        
        # Try to extract more metadata based on type
        if comp_type == "flow" and name.endswith('.json'):
            component["metadata"] = self._parse_flow_metadata(path)
        elif comp_type == "entity" and os.path.isdir(path):
            component["metadata"] = self._parse_entity_metadata(path)
        
        return component
    
    def _get_description(self, comp_type: str, name: str) -> str:
        """Generate description based on component type"""
        descriptions = {
            "flow": f"Power Automate Flow: {name}",
            "canvasapp": f"Canvas App: {name}",
            "entity": f"Dataverse Table: {name}",
            "webresource": f"Web Resource: {name}",
            "plugin": f"Plugin Assembly: {name}",
            "report": f"Report: {name}"
        }
        return descriptions.get(comp_type, f"Component: {name}")
    
    def _parse_flow_metadata(self, filepath: str) -> Dict:
        """Parse Power Automate flow JSON for metadata"""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                flow_data = json.load(f)
            
            definition = flow_data.get("definition", {})
            return {
                "triggers": list(definition.get("triggers", {}).keys()),
                "actions": list(definition.get("actions", {}).keys())[:10]  # Limit to 10
            }
        except:
            return {}
    
    def _parse_entity_metadata(self, entity_path: str) -> Dict:
        """Parse entity directory for metadata"""
        attributes = []
        attrs_dir = os.path.join(entity_path, "Attributes")
        
        if os.path.exists(attrs_dir):
            for attr_file in os.listdir(attrs_dir)[:10]:  # Limit to 10
                if attr_file.endswith('.xml'):
                    attributes.append(attr_file.replace('.xml', ''))
        
        return {"attributes": attributes}







class DataverseParser:
    """
    Comprehensive Dataverse solution parser.
    Operates on an already-unpacked solution directory.
    """

    def __init__(self, extract_dir: str, verbose: bool = False):
        self.extract_dir = Path(extract_dir)
        self.verbose = verbose
        self._log(f"DataverseParser initialized on: {self.extract_dir}")

    def _log(self, msg: str):
        if self.verbose:
            print(f"  [DV] {msg}")

    def _text(self, element: ET.Element, tag: str) -> str:
        """Helper to safely extract text from XML element by tag name."""
        child = element.find(tag)
        if child is not None and child.text:
            return child.text.strip()
        # Try without namespace
        child = element.find(f".//{tag}")
        if child is not None and child.text:
            return child.text.strip()
        return ""

    # ──────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────

    def parse_all(self, sections: Optional[List[str]] = None) -> Dict[str, Any]:
        """Parse all (or selected) sections from the unpacked solution.

        Args:
            sections: list of section names to parse. None = all.
                      Valid: metadata, artifacts, automation, security, dependencies

        Returns:
            Dict with each section's parsed data + summary stats.
        """
        all_sections = ["metadata", "artifacts", "automation", "security", "dependencies"]
        active = sections or all_sections

        result: Dict[str, Any] = {
            "parser": "DataverseParser",
            "parsed_at": datetime.now(timezone.utc).isoformat(),
            "source_dir": str(self.extract_dir),
            "sections": active,
        }

        # Solution-level info
        result["solution"] = self._parse_solution_manifest()

        # Inventory what folders actually exist
        result["folder_inventory"] = self._inventory_folders()

        # The big customizations.xml — parsed once, shared across sections
        cust = self._parse_customizations_xml()

        if "metadata" in active:
            result["metadata"] = self._parse_metadata(cust)
        if "artifacts" in active:
            result["artifacts"] = self._parse_artifacts(cust)
        if "automation" in active:
            result["automation"] = self._parse_automation(cust)
        if "security" in active:
            result["security"] = self._parse_security()
        if "dependencies" in active:
            result["dependencies"] = self._build_dependencies(result)

        result["summary"] = self._build_summary(result)
        return result

    def _inventory_folders(self) -> Dict[str, Any]:
        """Catalog what's actually in the extracted directory."""
        inv: Dict[str, Any] = {"folders": {}, "total_files": 0}
        if not self.extract_dir.exists():
            return inv
        for item in sorted(self.extract_dir.iterdir()):
            if item.is_dir():
                flist = [f for f in item.rglob("*") if f.is_file()]
                exts: Dict[str, int] = defaultdict(int)
                for f in flist:
                    exts[f.suffix.lower() or "(none)"] += 1
                inv["folders"][item.name] = {"file_count": len(flist), "extensions": dict(exts)}
                inv["total_files"] += len(flist)
        return inv

    # ──────────────────────────────────────────────────────────────────
    # Solution manifest
    # ──────────────────────────────────────────────────────────────────

    def _parse_solution_manifest(self) -> Dict[str, str]:
        """Read solution.xml for name, version, publisher."""
        for candidate in [
            self.extract_dir / "Other" / "solution.xml",
            self.extract_dir / "Other" / "Solution.xml",
            self.extract_dir / "solution.xml",
            self.extract_dir / "Solution.xml",
        ]:
            if candidate.exists():
                return self._read_solution_xml(candidate)

        # Recursive fallback
        for p in self.extract_dir.rglob("solution.xml"):
            return self._read_solution_xml(p)
        for p in self.extract_dir.rglob("Solution.xml"):
            return self._read_solution_xml(p)

        return {"name": "Unknown", "version": "", "publisher": ""}

    def _read_solution_xml(self, path: Path) -> Dict[str, str]:
        try:
            tree = ET.parse(str(path))
            root = tree.getroot()
            info = {"name": "", "version": "", "publisher": "", "managed": False}
            for el in root.iter():
                tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                if tag == "UniqueName" and el.text and not info["name"]:
                    info["name"] = el.text.strip()
                elif tag == "Version" and el.text and not info["version"]:
                    info["version"] = el.text.strip()
                elif tag == "Managed" and el.text:
                    info["managed"] = el.text.strip() == "1"
            # Publisher
            for pub in root.iter():
                ptag = pub.tag.split("}")[-1] if "}" in pub.tag else pub.tag
                if ptag == "Publisher":
                    for ch in pub:
                        ct = ch.tag.split("}")[-1] if "}" in ch.tag else ch.tag
                        if ct == "UniqueName" and ch.text:
                            info["publisher"] = ch.text.strip()
                            break
            return info
        except ET.ParseError:
            return {"name": "Unknown", "version": "", "publisher": ""}

    # ──────────────────────────────────────────────────────────────────
    # customizations.xml — the master file
    # ──────────────────────────────────────────────────────────────────

    def _parse_customizations_xml(self) -> Dict[str, Any]:
        """Parse the main customizations.xml. Returns raw parsed dicts."""
        cust_path = None
        for candidate in [
            self.extract_dir / "Other" / "customizations.xml",
            self.extract_dir / "Other" / "Customizations.xml",
            self.extract_dir / "customizations.xml",
            self.extract_dir / "Customizations.xml",
        ]:
            if candidate.exists():
                cust_path = candidate
                break

        if not cust_path:
            for p in self.extract_dir.rglob("customizations.xml"):
                cust_path = p
                break

        if not cust_path:
            self._log("customizations.xml not found")
            return {"entities": [], "option_sets": [], "app_modules": [], "site_maps": []}

        self._log(f"Parsing customizations.xml ({cust_path.stat().st_size / 1024:.0f} KB)")

        try:
            tree = ET.parse(str(cust_path))
            root = tree.getroot()
        except ET.ParseError as e:
            self._log(f"XML parse error: {e}")
            return {"entities": [], "option_sets": [], "app_modules": [], "site_maps": []}

        entities = []
        for entity_el in root.iter("Entity"):
            ent = self._parse_entity_element(entity_el)
            if ent.get("logical_name"):
                entities.append(ent)

        option_sets = []
        # Global option sets at root level
        for os_el in root.iter("optionset"):
            # Only global ones (not inside an attribute)
            parent = None
            for p in root.iter():
                if os_el in list(p):
                    parent = p
                    break
            parent_tag = (parent.tag.split("}")[-1] if parent is not None and "}" in parent.tag
                          else parent.tag if parent is not None else "")
            if parent_tag not in ("attribute", "Attribute"):
                option_sets.append(self._parse_optionset_element(os_el))

        app_modules = []
        for app in root.iter("AppModule"):
            app_modules.append({
                "unique_name": self._text(app, "UniqueName"),
                "display_name": self._text(app, "Name") or self._text(app, "name"),
            })

        site_maps = []
        for sm in root.iter("SiteMap"):
            areas = []
            for area in sm.iter("Area"):
                subareas = []
                for sa in area.iter("SubArea"):
                    subareas.append({
                        "id": sa.get("Id", ""),
                        "entity": sa.get("Entity", ""),
                        "url": sa.get("Url", ""),
                        "title": sa.get("Title", ""),
                    })
                areas.append({
                    "id": area.get("Id", ""),
                    "title": area.get("Title", ""),
                    "subareas": subareas,
                })
            site_maps.append({"areas": areas})

        return {
            "entities": entities,
            "option_sets": option_sets,
            "app_modules": app_modules,
            "site_maps": site_maps,
        }

    # ──────────────────────────────────────────────────────────────────
    # Entity / Table parsing
    # ──────────────────────────────────────────────────────────────────

    def _parse_entity_element(self, el: ET.Element) -> Dict[str, Any]:
        """Parse a single <Entity> from customizations.xml."""
        ent: Dict[str, Any] = {
            "logical_name": "",
            "display_name": "",
            "is_custom": False,
            "ownership_type": "",
            "attributes": [],
            "forms": [],
            "views": [],
            "business_rules": [],
            "relationships_1n": [],
            "relationships_n1": [],
            "relationships_nn": [],
            "keys": [],
        }

        # Name
        ent["logical_name"] = (
            self._text(el, "Name")
            or self._text(el, "name")
            or self._text(el, "n")
            or ""
        ).strip()

        # Display name
        ln = el.find(".//LocalizedNames/LocalizedName")
        if ln is not None:
            ent["display_name"] = ln.get("description", "")

        # EntityInfo block
        ei = el.find("EntityInfo/entity") or el.find(".//EntityInfo/entity")
        if ei is not None:
            if ei.get("Name"):
                ent["logical_name"] = ei.get("Name")
            ent["is_custom"] = self._text(ei, "IsCustomEntity") == "1"
            ent["ownership_type"] = self._text(ei, "OwnershipType") or ""

        # Attributes / Columns
        for attr_el in el.iter("attribute"):
            col = self._parse_attribute_element(attr_el)
            if col.get("logical_name"):
                ent["attributes"].append(col)

        # Forms
        for form_el in el.iter("systemform"):
            form = self._parse_form_element(form_el)
            ent["forms"].append(form)

        # Views
        for view_el in el.iter("savedquery"):
            view = self._parse_view_element(view_el)
            ent["views"].append(view)

        # Business rules (Category=2 workflows)
        for wf_el in el.iter("Workflow"):
            if self._text(wf_el, "Category") == "2":
                ent["business_rules"].append({
                    "id": self._text(wf_el, "WorkflowId") or "",
                    "name": self._text(wf_el, "Name") or "",
                    "state": self._text(wf_el, "StateCode") or "",
                    "scope": self._text(wf_el, "Scope") or "",
                })

        # Relationships
        for rel_el in el.iter("EntityRelationship"):
            rel = self._parse_relationship_element(rel_el)
            rtype = rel.pop("_raw_type", "")
            if rtype == "OneToMany":
                ent["relationships_1n"].append(rel)
            elif rtype == "ManyToOne":
                ent["relationships_n1"].append(rel)
            elif rtype == "ManyToMany":
                ent["relationships_nn"].append(rel)

        # Alternate keys
        for key_el in el.iter("EntityKey"):
            key = {
                "logical_name": self._text(key_el, "LogicalName") or "",
                "display_name": "",
                "key_attributes": [],
            }
            kln = key_el.find("LocalizedNames/LocalizedName")
            if kln is not None:
                key["display_name"] = kln.get("description", "")
            for ka in key_el.iter("EntityKeyAttribute"):
                if ka.text:
                    key["key_attributes"].append(ka.text.strip())
            ent["keys"].append(key)

        return ent

    def _parse_attribute_element(self, el: ET.Element) -> Dict[str, Any]:
        """Parse a single <attribute> element."""
        col: Dict[str, Any] = {
            "logical_name": el.get("PhysicalName", self._text(el, "LogicalName") or ""),
            "display_name": "",
            "type": self._text(el, "Type") or "",
            "required_level": self._text(el, "RequiredLevel") or "",
            "max_length": self._text(el, "MaxLength") or "",
            "is_custom": False,
            "description": self._text(el, "Description") or "",
            "option_set": None,
        }
        ln = el.find(".//LocalizedNames/LocalizedName")
        if ln is not None:
            col["display_name"] = ln.get("description", "")

        name = col["logical_name"].lower()
        col["is_custom"] = any(name.startswith(p) for p in ("cr_", "new_", "crc", "msdyn_"))

        os_el = el.find(".//optionset")
        if os_el is not None:
            col["option_set"] = self._parse_optionset_element(os_el)

        return col

    def _parse_optionset_element(self, el: ET.Element) -> Dict[str, Any]:
        """Parse an <optionset> element."""
        os_info: Dict[str, Any] = {
            "name": el.get("Name", self._text(el, "Name") or ""),
            "display_name": "",
            "type": self._text(el, "OptionSetType") or "Picklist",
            "options": [],
        }
        ln = el.find("LocalizedNames/LocalizedName")
        if ln is not None:
            os_info["display_name"] = ln.get("description", "")

        for opt in el.iter("option"):
            label = ""
            lbl = opt.find("labels/label") or opt.find(".//label")
            if lbl is not None:
                label = lbl.get("description", "")
            os_info["options"].append({"value": opt.get("value", ""), "label": label})

        return os_info

    def _parse_relationship_element(self, el: ET.Element) -> Dict[str, Any]:
        return {
            "name": el.get("Name", ""),
            "_raw_type": self._text(el, "EntityRelationshipType") or "",
            "referenced_entity": self._text(el, "ReferencedEntity") or "",
            "referencing_entity": self._text(el, "ReferencingEntity") or "",
            "referencing_attribute": self._text(el, "ReferencingAttribute") or "",
        }

    def _parse_form_element(self, el: ET.Element) -> Dict[str, Any]:
        form: Dict[str, Any] = {
            "id": self._text(el, "formid") or "",
            "name": "",
            "type_code": self._text(el, "type") or "",
            "type_label": "",
            "tabs": [],
            "sections": [],
            "fields_on_form": [],
        }
        form["type_label"] = FORM_TYPE_MAP.get(form["type_code"], f"Other({form['type_code']})")

        ln = el.find("LocalizedNames/LocalizedName")
        if ln is not None:
            form["name"] = ln.get("description", "")

        # Parse formxml if present
        formxml_text = self._text(el, "formxml")
        if formxml_text:
            self._enrich_form_from_xml(form, formxml_text)

        return form

    def _enrich_form_from_xml(self, form: Dict, xml_str: str):
        """Parse form XML string to extract tabs, sections, fields."""
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            return

        for tab in root.iter("tab"):
            tab_name = tab.get("name", "")
            lbl = tab.find("labels/label")
            form["tabs"].append({
                "name": tab_name,
                "label": lbl.get("description", "") if lbl is not None else "",
                "visible": tab.get("visible", "true"),
            })

            for section in tab.iter("section"):
                sec_name = section.get("name", "")
                sec_lbl = section.find("labels/label")
                form["sections"].append({
                    "tab": tab_name,
                    "name": sec_name,
                    "label": sec_lbl.get("description", "") if sec_lbl is not None else "",
                })

                for cell in section.iter("cell"):
                    ctrl = cell.find("control")
                    if ctrl is not None:
                        field = ctrl.get("datafieldname", ctrl.get("id", ""))
                        if field:
                            form["fields_on_form"].append({
                                "field": field,
                                "tab": tab_name,
                                "section": sec_name,
                                "disabled": ctrl.get("disabled", "false"),
                            })

    def _parse_view_element(self, el: ET.Element) -> Dict[str, Any]:
        view: Dict[str, Any] = {
            "id": self._text(el, "savedqueryid") or "",
            "name": "",
            "query_type": self._text(el, "querytype") or "",
            "is_default": self._text(el, "isdefault") == "1",
            "columns": [],
            "filter_conditions": [],
            "linked_entities": [],
            "sort_columns": [],
        }
        ln = el.find("LocalizedNames/LocalizedName")
        if ln is not None:
            view["name"] = ln.get("description", "")

        # FetchXML
        fetch = self._text(el, "fetchxml")
        if fetch:
            self._enrich_view_from_fetchxml(view, fetch)

        # LayoutXML
        layout = self._text(el, "layoutxml")
        if layout:
            try:
                lroot = ET.fromstring(layout)
                for cell in lroot.iter("cell"):
                    view["columns"].append({
                        "name": cell.get("name", ""),
                        "width": cell.get("width", ""),
                    })
            except ET.ParseError:
                pass

        return view

    def _enrich_view_from_fetchxml(self, view: Dict, xml_str: str):
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            return

        for cond in root.iter("condition"):
            view["filter_conditions"].append({
                "attribute": cond.get("attribute", ""),
                "operator": cond.get("operator", ""),
                "value": cond.get("value", ""),
            })

        for link in root.iter("link-entity"):
            view["linked_entities"].append({
                "name": link.get("name", ""),
                "from": link.get("from", ""),
                "to": link.get("to", ""),
                "link_type": link.get("link-type", "inner"),
                "alias": link.get("alias", ""),
            })

        for order in root.iter("order"):
            view["sort_columns"].append({
                "attribute": order.get("attribute", ""),
                "descending": order.get("descending", "false") == "true",
            })

    # ──────────────────────────────────────────────────────────────────
    # Section 1: Metadata
    # ──────────────────────────────────────────────────────────────────

    def _parse_metadata(self, cust: Dict) -> Dict[str, Any]:
        """Section 1: tables, columns, relationships, choices, keys."""
        entities = cust.get("entities", [])

        # Also scan Entity/ folder for any not in customizations.xml
        entities = self._merge_entity_folder_files(entities)

        all_rels = []
        for ent in entities:
            for rel in ent.get("relationships_1n", []):
                all_rels.append({**rel, "source_entity": ent["logical_name"], "direction": "1:N"})
            for rel in ent.get("relationships_n1", []):
                all_rels.append({**rel, "source_entity": ent["logical_name"], "direction": "N:1"})
            for rel in ent.get("relationships_nn", []):
                all_rels.append({**rel, "source_entity": ent["logical_name"], "direction": "N:N"})

        total_cols = sum(len(e.get("attributes", [])) for e in entities)
        total_keys = sum(len(e.get("keys", [])) for e in entities)
        total_choices = len(cust.get("option_sets", []))
        for e in entities:
            for a in e.get("attributes", []):
                if a.get("option_set"):
                    total_choices += 1

        return {
            "tables": entities,
            "global_option_sets": cust.get("option_sets", []),
            "all_relationships": all_rels,
            "stats": {
                "tables": len(entities),
                "columns": total_cols,
                "relationships": len(all_rels),
                "choices": total_choices,
                "keys": total_keys,
            },
        }

    def _merge_entity_folder_files(self, entities: List[Dict]) -> List[Dict]:
        """Merge entities found in Entities/ folder that aren't in customizations.xml."""
        known = {e["logical_name"].lower() for e in entities if e.get("logical_name")}
        entities_dir = self.extract_dir / "Entities"
        if not entities_dir.exists():
            return entities

        for item in entities_dir.iterdir():
            if item.is_dir():
                name = item.name.lower()
                if name not in known:
                    entity_xml = item / "Entity.xml"
                    if entity_xml.exists():
                        try:
                            tree = ET.parse(str(entity_xml))
                            root = tree.getroot()
                            logical = self._text(root, "Name") or self._text(root, "LogicalName") or name
                            entities.append({
                                "logical_name": logical,
                                "display_name": "",
                                "is_custom": logical.startswith(("cr_", "new_", "msdyn_")),
                                "ownership_type": "",
                                "attributes": [], "forms": [], "views": [],
                                "business_rules": [], "relationships_1n": [],
                                "relationships_n1": [], "relationships_nn": [],
                                "keys": [], "source": "entity_folder",
                            })
                        except ET.ParseError:
                            pass
        return entities

    # ──────────────────────────────────────────────────────────────────
    # Section 2: Artifacts
    # ──────────────────────────────────────────────────────────────────

    def _parse_artifacts(self, cust: Dict) -> Dict[str, Any]:
        """Section 2: forms, views, dashboards, apps, business rules, web resources, canvas apps."""
        forms = []
        views = []
        dashboards = []
        business_rules = []

        for ent in cust.get("entities", []):
            ename = ent.get("logical_name", "")
            for f in ent.get("forms", []):
                f["entity"] = ename
                if f.get("type_code") == "0":
                    dashboards.append(f)
                else:
                    forms.append(f)
            for v in ent.get("views", []):
                v["entity"] = ename
                views.append(v)
            for br in ent.get("business_rules", []):
                br["entity"] = ename
                business_rules.append(br)

        # Canvas apps — can be subdirectories OR flat files with .meta.xml pairs
        canvas_apps = []
        ca_dir = self.extract_dir / "CanvasApps"
        if not ca_dir.exists():
            ca_dir = self.extract_dir / "canvasapps"
        if ca_dir.exists():
            # Group files by app prefix 
            meta_files = {}
            for item in ca_dir.iterdir():
                if item.is_file() and item.name.endswith(".meta.xml"):
                    # This is a canvas app metadata file
                    # Prefix is everything before .meta.xml
                    prefix = item.name.replace(".meta.xml", "")
                    meta_info: Dict[str, Any] = {"name": prefix, "meta_file": item.name}
                    try:
                        tree = ET.parse(str(item))
                        r = tree.getroot()
                        meta_info["app_name"] = self._text(r, "CanvasAppName") or self._text(r, "Name") or ""
                        meta_info["description"] = self._text(r, "Description") or ""
                        meta_info["app_version"] = self._text(r, "CanvasAppVersion") or ""
                    except ET.ParseError:
                        pass
                    meta_files[prefix] = meta_info

            for item in ca_dir.iterdir():
                if item.is_dir():
                    # Subdirectory-style canvas app
                    info: Dict[str, Any] = {"name": item.name, "is_dir": True}
                    for mn in ("Properties.json", "properties.json",
                               "CanvasManifest.json", "canvasmanifest.json"):
                        mp = item / mn
                        if mp.exists():
                            try:
                                with open(mp, "r", encoding="utf-8") as fh:
                                    d = json.load(fh)
                                info["app_name"] = d.get("Name", d.get("name", ""))
                                info["description"] = d.get("Description", d.get("description", ""))
                            except Exception:
                                pass
                            break
                    canvas_apps.append(info)
                elif item.is_file() and not item.name.endswith(".meta.xml"):
                    # Non-meta file — check if there's a matching .meta.xml
                    info = {"name": item.name, "is_dir": False, "size": item.stat().st_size,
                            "extension": item.suffix.lower()}
                    # Try to find matching meta
                    for prefix, meta in meta_files.items():
                        if item.name.startswith(prefix):
                            info.update(meta)
                            break
                    canvas_apps.append(info)

        # Bots / Copilot Studio
        bots = []
        bot_dir = self.extract_dir / "bots"
        if bot_dir.exists():
            for item in bot_dir.iterdir():
                bot: Dict[str, Any] = {"name": item.name, "path": str(item.relative_to(self.extract_dir))}
                if item.is_dir():
                    bot["file_count"] = sum(1 for _ in item.rglob("*") if _.is_file())
                    # Try bot.xml (PAC CLI format)
                    bot_xml = item / "bot.xml"
                    if bot_xml.exists():
                        try:
                            tree = ET.parse(str(bot_xml))
                            r = tree.getroot()
                            bot["display_name"] = self._text(r, "name") or self._text(r, "Name") or ""
                            bot["schema_name"] = self._text(r, "schemaname") or self._text(r, "SchemaName") or ""
                            bot["description"] = self._text(r, "description") or ""
                        except ET.ParseError:
                            pass
                    # Try configuration.json
                    config_json = item / "configuration.json"
                    if config_json.exists():
                        try:
                            with open(config_json, "r", encoding="utf-8") as fh:
                                d = json.load(fh)
                            if not bot.get("display_name"):
                                bot["display_name"] = d.get("name", d.get("displayName", ""))
                            bot["configuration"] = {
                                k: v for k, v in d.items()
                                if k in ("language", "authenticationMode", "schemaName",
                                         "iconUrl", "applicationManifestInformation")
                            }
                        except (json.JSONDecodeError, KeyError):
                            pass
                    # Try bot.json (alternate format)
                    for mn in ("bot.json", "manifest.json"):
                        mp = item / mn
                        if mp.exists():
                            try:
                                with open(mp, "r", encoding="utf-8") as fh:
                                    d = json.load(fh)
                                if not bot.get("display_name"):
                                    bot["display_name"] = d.get("name", d.get("displayName", ""))
                                if not bot.get("schema_name"):
                                    bot["schema_name"] = d.get("schemaName", d.get("schemaname", ""))
                            except (json.JSONDecodeError, KeyError):
                                pass
                            break
                elif item.is_file():
                    if item.suffix.lower() == ".json":
                        try:
                            with open(item, "r", encoding="utf-8") as fh:
                                d = json.load(fh)
                            bot["display_name"] = d.get("name", d.get("displayName", item.stem))
                            bot["schema_name"] = d.get("schemaName", "")
                        except (json.JSONDecodeError, KeyError):
                            pass
                    elif item.suffix.lower() == ".xml":
                        try:
                            tree = ET.parse(str(item))
                            r = tree.getroot()
                            bot["display_name"] = self._text(r, "name") or item.stem
                        except ET.ParseError:
                            pass
                bots.append(bot)

        # Bot components (Copilot Studio topics, dialogs, etc.)
        bot_components = []
        bc_dir = self.extract_dir / "botcomponents"
        if bc_dir.exists():
            for item in bc_dir.iterdir():
                if item.is_dir():
                    # Each subdirectory is a topic/component (e.g., cr6e9_replybraryAgent.topic.Greeting)
                    comp: Dict[str, Any] = {
                        "name": item.name,
                        "type": "topic" if ".topic." in item.name else
                                "gpt" if ".gpt." in item.name else "component",
                        "file_count": sum(1 for _ in item.rglob("*") if _.is_file()),
                    }
                    # Extract topic name from folder name
                    # Pattern: prefix.topic.TopicName or prefix.gpt.default
                    parts = item.name.split(".")
                    if len(parts) >= 3:
                        comp["topic_name"] = parts[-1]
                    bot_components.append(comp)
                elif item.is_file():
                    bot_components.append({
                        "name": item.name,
                        "type": "file",
                        "extension": item.suffix.lower(),
                        "size": item.stat().st_size,
                    })

        # Dataverse search definitions (knowledge sources)
        dv_searches = []
        for dn in ("dvtablesearchs", "dvtablesearches"):
            ds_dir = self.extract_dir / dn
            if ds_dir.exists():
                # Each subdirectory contains a search configuration
                for item in ds_dir.iterdir():
                    if item.is_dir():
                        xml_file = item / "dvtablesearch.xml"
                        if xml_file.exists():
                            try:
                                tree = ET.parse(str(xml_file))
                                root = tree.getroot()
                                
                                search_config = {
                                    'id': root.get('dvtablesearchid', ''),
                                    'name': self._text(root, 'name'),
                                    'search_type': self._text(root, 'searchtype'),
                                    'state_code': self._text(root, 'statecode'),
                                    'status_code': self._text(root, 'statuscode'),
                                    'is_customizable': self._text(root, 'iscustomizable'),
                                    'connection_reference': self._text(root, 'connectionreference/connectionreferencelogicalname'),
                                    'knowledge_sources': []
                                }
                                
                                # Parse knowledge config JSON embedded in XML
                                knowledge_config = self._text(root, 'knowledgeconfig')
                                if knowledge_config:
                                    try:
                                        config_data = json.loads(knowledge_config)
                                        
                                        # Extract drive items (SharePoint lists, document libraries, etc.)
                                        for drive_item in config_data.get('driveItems', []):
                                            source = {
                                                'type': drive_item.get('$kind', ''),
                                                'display_name': drive_item.get('displayName', ''),
                                                'web_url': drive_item.get('webUrl', ''),
                                                'drive_id': drive_item.get('driveId', ''),
                                                'item_id': drive_item.get('itemId', '')
                                            }
                                            
                                            # Extract SharePoint IDs if present
                                            sp_ids = drive_item.get('sharepointIds', {})
                                            if sp_ids:
                                                source['sharepoint'] = {
                                                    'site_url': sp_ids.get('siteUrl', ''),
                                                    'site_id': sp_ids.get('siteId', ''),
                                                    'web_id': sp_ids.get('webId', ''),
                                                    'list_id': sp_ids.get('listId', '')
                                                }
                                            
                                            search_config['knowledge_sources'].append(source)
                                    except json.JSONDecodeError:
                                        pass
                                
                                dv_searches.append(search_config)
                            except ET.ParseError:
                                pass
                    elif item.is_file():
                        # Fallback: flat file
                        dv_searches.append({"name": item.stem, "file": item.name})
                break

        # Dataverse search entities (which tables have search enabled)
        dv_search_entities = []
        dse_dir = self.extract_dir / "dvtablesearchentities"
        if dse_dir.exists():
            # Each subdirectory contains a search entity configuration
            for item in dse_dir.iterdir():
                if item.is_dir():
                    xml_file = item / "dvtablesearchentity.xml"
                    if xml_file.exists():
                        try:
                            tree = ET.parse(str(xml_file))
                            root = tree.getroot()
                            
                            entity_config = {
                                'id': root.get('dvtablesearchentityid', ''),
                                'dvtablesearch_id': self._text(root, 'dvtablesearch/dvtablesearchid'),
                                'entity_logical_name': self._text(root, 'entitylogicalname'),
                                'name': self._text(root, 'name'),
                                'state_code': self._text(root, 'statecode'),
                                'status_code': self._text(root, 'statuscode'),
                                'is_customizable': self._text(root, 'iscustomizable') == '1'
                            }
                            
                            dv_search_entities.append(entity_config)
                        except ET.ParseError:
                            pass
                elif item.is_file():
                    # Fallback: flat file format
                    if item.suffix.lower() == ".xml":
                        try:
                            tree = ET.parse(str(item))
                            root = tree.getroot()
                            entity_config = {
                                'id': root.get('dvtablesearchentityid', ''),
                                'name': self._text(root, 'name'),
                                'entity_logical_name': self._text(root, 'entitylogicalname')
                            }
                            dv_search_entities.append(entity_config)
                        except ET.ParseError:
                            pass
                    elif item.suffix.lower() == ".json":
                        try:
                            with open(item, "r", encoding="utf-8") as fh:
                                d = json.load(fh)
                            entity_config = {
                                'name': d.get("name", d.get("entity", item.stem)),
                                'entity_logical_name': d.get("entitylogicalname", d.get("entity", ""))
                            }
                            dv_search_entities.append(entity_config)
                        except json.JSONDecodeError:
                            pass

        # Assets
        assets = []
        assets_dir = self.extract_dir / "Assets"
        if not assets_dir.exists():
            assets_dir = self.extract_dir / "assets"
        if assets_dir.exists():
            for item in assets_dir.rglob("*"):
                if item.is_file():
                    assets.append({
                        "name": item.name,
                        "extension": item.suffix.lower(),
                        "size": item.stat().st_size,
                    })

        # Web resources
        web_resources = []
        wr_dir = self.extract_dir / "WebResources"
        if wr_dir.exists():
            for item in wr_dir.rglob("*"):
                if item.is_file():
                    ext = item.suffix.lower()
                    wr_type = {
                        ".html": "HTML", ".htm": "HTML", ".js": "JavaScript",
                        ".css": "Stylesheet", ".png": "Image", ".jpg": "Image",
                        ".gif": "Image", ".svg": "Image", ".ico": "Image",
                        ".xml": "XML", ".resx": "Resource", ".xap": "Silverlight",
                    }.get(ext, f"Other({ext})")
                    web_resources.append({
                        "name": item.name,
                        "path": str(item.relative_to(self.extract_dir)),
                        "type": wr_type,
                        "extension": ext,
                        "size": item.stat().st_size,
                    })

        return {
            "forms": forms,
            "views": views,
            "dashboards": dashboards,
            "model_driven_apps": cust.get("app_modules", []),
            "canvas_apps": canvas_apps,
            "bots": bots,
            "bot_components": bot_components,
            "business_rules": business_rules,
            "web_resources": web_resources,
            "dv_searches": dv_searches,
            "dv_search_entities": dv_search_entities,
            "assets": assets,
            "site_maps": cust.get("site_maps", []),
            "stats": {
                "forms": len(forms),
                "views": len(views),
                "dashboards": len(dashboards),
                "apps": len(cust.get("app_modules", [])) + len(canvas_apps),
                "model_driven_apps": len(cust.get("app_modules", [])),
                "canvas_apps": len(canvas_apps),
                "bots": len(bots),
                "bot_components": len(bot_components),
                "business_rules": len(business_rules),
                "web_resources": len(web_resources),
                "dv_searches": len(dv_searches),
                "dv_search_entities": len(dv_search_entities),
                "assets": len(assets),
            },
        }

    # ──────────────────────────────────────────────────────────────────
    # Section 3: Automation
    # ──────────────────────────────────────────────────────────────────

    def _parse_automation(self, cust: Dict) -> Dict[str, Any]:
        """Section 3: cloud flows, classic workflows, plugin steps."""
        cloud_flows = []
        classic_workflows = []

        # Workflows/ folder — each flow has a .json definition
        # and a .json.data.xml companion file (skip the companion)
        wf_dir = self.extract_dir / "Workflows"
        if wf_dir.exists():
            for item in wf_dir.rglob("*"):
                if item.is_file():
                    fname = item.name.lower()
                    # Skip .json.data.xml companion files
                    if fname.endswith(".data.xml"):
                        continue
                    if item.suffix.lower() == ".json":
                        flow = self._parse_cloud_flow_json(item)
                        if flow:
                            cloud_flows.append(flow)
                    elif item.suffix.lower() in (".xaml", ".xml"):
                        classic_workflows.append({
                            "name": item.stem,
                            "file": item.name,
                            "type": "Classic Workflow",
                        })

        # Plugin steps
        plugin_steps = []
        plugin_assemblies = []

        sdk_dir = self.extract_dir / "SdkMessageProcessingSteps"
        if sdk_dir.exists():
            for item in sdk_dir.rglob("*.xml"):
                step = self._parse_plugin_step_xml(item)
                if step:
                    plugin_steps.append(step)

        pa_dir = self.extract_dir / "PluginAssemblies"
        if pa_dir.exists():
            for item in pa_dir.rglob("*"):
                if item.is_file():
                    plugin_assemblies.append({
                        "name": item.name,
                        "size": item.stat().st_size,
                    })

        # Connection references
        conn_refs = []
        cr_dir = self.extract_dir / "ConnectionReferences"
        if cr_dir.exists():
            for item in cr_dir.rglob("*"):
                if item.is_file():
                    cr = self._parse_json_or_xml_file(item, {
                        "connectionreferencelogicalname": "name",
                        "connectionreferencedisplayname": "display_name",
                        "connectorid": "connector_id",
                    })
                    if cr:
                        conn_refs.append(cr)

        # Environment variables — each is a subdirectory
        # containing JSON/XML definition files
        env_vars = []
        ev_dir = self.extract_dir / "environmentvariabledefinitions"
        if not ev_dir.exists():
            ev_dir = self.extract_dir / "EnvironmentVariableDefinitions"
        if ev_dir.exists():
            for item in ev_dir.iterdir():
                if item.is_dir():
                    # Each subdirectory is one env variable
                    ev_info: Dict[str, Any] = {"name": item.name, "display_name": "", "type": "", "default_value": ""}
                    # Parse files inside the subdirectory
                    for f in item.rglob("*"):
                        if f.is_file():
                            ev = self._parse_json_or_xml_file(f, {
                                "schemaname": "name",
                                "displayname": "display_name",
                                "type": "type",
                                "defaultvalue": "default_value",
                            })
                            if ev:
                                # Merge — prefer non-empty values
                                for k, v in ev.items():
                                    if v and not ev_info.get(k):
                                        ev_info[k] = v
                    env_vars.append(ev_info)
                elif item.is_file():
                    # Flat file format (fallback)
                    ev = self._parse_json_or_xml_file(item, {
                        "schemaname": "name",
                        "displayname": "display_name",
                        "type": "type",
                        "defaultvalue": "default_value",
                    })
                    if ev:
                        env_vars.append(ev)

        return {
            "cloud_flows": cloud_flows,
            "classic_workflows": classic_workflows,
            "plugin_steps": plugin_steps,
            "plugin_assemblies": plugin_assemblies,
            "connection_references": conn_refs,
            "environment_variables": env_vars,
            "stats": {
                "cloud_flows": len(cloud_flows),
                "workflows": len(classic_workflows),
                "plugin_steps": len(plugin_steps),
                "plugin_assemblies": len(plugin_assemblies),
                "connection_references": len(conn_refs),
                "environment_variables": len(env_vars),
            },
        }

    def _parse_cloud_flow_json(self, path: Path) -> Optional[Dict[str, Any]]:
        """Parse a cloud flow definition JSON."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return None

        props = data.get("properties", data)
        definition = props.get("definition", {})

        # Some solutions store flows differently — definition at top level
        if not definition and "triggers" in data:
            definition = data
        if not definition and "triggers" in props:
            definition = props

        flow: Dict[str, Any] = {
            "flow_id": data.get("name", ""),
            "display_name": props.get("displayName", path.stem),
            "state": props.get("state", "Unknown"),
            "created": props.get("createdTime", ""),
            "modified": props.get("lastModifiedTime", ""),
            "description": props.get("description", ""),
            "source_file": str(path.relative_to(self.extract_dir)),
            "connectors": [],
            "triggers": [],
            "dataverse_tables": [],
            "child_flow_calls": [],
            "action_count": 0,
        }

        # Connectors
        for key, ref in props.get("connectionReferences", {}).items():
            api_id = ref.get("id", "")
            short = api_id.rsplit("/", 1)[-1] if "/" in api_id else key
            flow["connectors"].append({
                "key": key,
                "name": ref.get("displayName", short),
                "api": short,
            })

        # Triggers
        for tname, trig in definition.get("triggers", {}).items():
            ti: Dict[str, Any] = {
                "name": tname,
                "type": trig.get("type", ""),
                "kind": trig.get("kind", ""),
                "dataverse_table": None,
                "recurrence": None,
            }
            if trig.get("type") == "Recurrence":
                rec = trig.get("recurrence", {})
                ti["recurrence"] = f"Every {rec.get('interval', '?')} {rec.get('frequency', '?')}"

            inp = trig.get("inputs", {})
            params = inp.get("parameters", {})
            host = inp.get("host", {})
            if DATAVERSE_API_ID in host.get("apiId", ""):
                ti["dataverse_table"] = (
                    params.get("subscriptionRequest/entityname")
                    or params.get("entityName")
                )
            flow["triggers"].append(ti)

        # Actions — recursive walk
        actions = definition.get("actions", {})
        flow["action_count"] = self._count_actions(actions)
        tables, child_flows = self._walk_flow_actions(actions)
        flow["dataverse_tables"] = tables
        flow["child_flow_calls"] = child_flows

        return flow

    def _walk_flow_actions(self, actions: Dict) -> Tuple[List[Dict], List[Dict]]:
        """Recursively walk flow actions to extract DV table refs and child flows."""
        tables: List[Dict] = []
        child_flows: List[Dict] = []

        for name, action in actions.items():
            # Handle case where action is not a dict
            if not isinstance(action, dict):
                continue
            
            inp = action.get("inputs", {})
            # Handle case where inputs is a string or other non-dict type
            if not isinstance(inp, dict):
                continue
                
            host = inp.get("host", {})
            params = inp.get("parameters", {})
            
            # Ensure host and params are dicts
            if not isinstance(host, dict):
                host = {}
            if not isinstance(params, dict):
                params = {}
                
            api_id = host.get("apiId", "")
            op_id = host.get("operationId", "")

            if DATAVERSE_API_ID in api_id:
                entity = params.get("entityName") or params.get("table")
                if entity:
                    tables.append({
                        "table": entity,
                        "operation": FLOW_OPERATION_MAP.get(op_id, op_id),
                        "action": name,
                        "filter": params.get("$filter"),
                        "select": params.get("$select"),
                    })

            if LOGICFLOWS_API_ID in api_id or op_id in ("RunFlow", "RunChildFlow"):
                child_flows.append({
                    "action": name,
                    "child_flow_id": params.get("flowId", params.get("name", "")),
                    "child_flow_name": params.get("name", ""),
                })

            # Recurse into nested scopes
            for nested_key in ("actions", "cases"):
                nested = action.get(nested_key, {})
                if isinstance(nested, dict):
                    if nested_key == "cases":
                        for cv in nested.values():
                            st, sf = self._walk_flow_actions(cv.get("actions", {}))
                            tables.extend(st)
                            child_flows.extend(sf)
                    else:
                        st, sf = self._walk_flow_actions(nested)
                        tables.extend(st)
                        child_flows.extend(sf)
            if "else" in action:
                st, sf = self._walk_flow_actions(action["else"].get("actions", {}))
                tables.extend(st)
                child_flows.extend(sf)

        return tables, child_flows

    def _count_actions(self, actions: Dict) -> int:
        count = len(actions)
        for action in actions.values():
            for key in ("actions", "cases"):
                nested = action.get(key, {})
                if isinstance(nested, dict):
                    if key == "cases":
                        for cv in nested.values():
                            count += self._count_actions(cv.get("actions", {}))
                    else:
                        count += self._count_actions(nested)
            if "else" in action:
                count += self._count_actions(action["else"].get("actions", {}))
        return count

    def _parse_plugin_step_xml(self, path: Path) -> Optional[Dict]:
        try:
            tree = ET.parse(str(path))
            root = tree.getroot()
            return {
                "name": self._text(root, "Name") or self._text(root, "name") or path.stem,
                "message": self._text(root, "SdkMessageId/Name") or "",
                "entity": (self._text(root, "PrimaryEntity")
                           or self._text(root, "SdkMessageFilterId/PrimaryObjectTypeCode") or ""),
                "stage": self._text(root, "Stage") or "",
                "mode": self._text(root, "Mode") or "",
                "rank": self._text(root, "Rank") or "",
                "filtering_attributes": self._text(root, "FilteringAttributes") or "",
                "state": self._text(root, "StateCode") or "",
                "assembly": self._text(root, "PluginTypeId/Name") or "",
            }
        except ET.ParseError:
            return None

    def _parse_json_or_xml_file(self, path: Path, field_map: Dict[str, str]) -> Optional[Dict]:
        """Generic parser for simple JSON or XML config files."""
        try:
            if path.suffix.lower() == ".json":
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return {v: data.get(k, "") for k, v in field_map.items()}
            else:
                tree = ET.parse(str(path))
                root = tree.getroot()
                result = {}
                for src_key, dest_key in field_map.items():
                    result[dest_key] = self._text(root, src_key) or ""
                return result
        except Exception:
            return None

    # ──────────────────────────────────────────────────────────────────
    # Section 4: Security
    # ──────────────────────────────────────────────────────────────────

    def _parse_security(self) -> Dict[str, Any]:
        """Section 4: security roles and privileges."""
        roles = []
        role_dir = self.extract_dir / "Roles"
        if role_dir.exists():
            for item in role_dir.rglob("*.xml"):
                role = self._parse_role_xml(item)
                if role:
                    roles.append(role)

        total_privs = sum(len(r.get("privileges", [])) for r in roles)
        return {
            "roles": roles,
            "stats": {
                "roles": len(roles),
                "privileges": total_privs,
                "teams": 0,  # teams not in solution files — API only
            },
        }

    def _parse_role_xml(self, path: Path) -> Optional[Dict]:
        try:
            tree = ET.parse(str(path))
            root = tree.getroot()
        except ET.ParseError:
            return None

        role: Dict[str, Any] = {
            "role_id": self._text(root, "roleid") or root.get("id", ""),
            "name": self._text(root, "name") or self._text(root, "Name") or path.stem,
            "is_managed": self._text(root, "ismanaged") == "1",
            "privileges": [],
        }

        for priv_el in root.iter("RolePrivilege"):
            p: Dict[str, str] = {
                "privilege_id": priv_el.get("privilegeid", priv_el.findtext("privilegeid", "")),
                "name": priv_el.get("name", priv_el.findtext("name", "")),
                "depth": priv_el.get("level", priv_el.findtext("depth", "")),
                "depth_label": PRIVILEGE_DEPTH_MAP.get(
                    priv_el.get("level", priv_el.findtext("depth", "")), ""
                ),
                "entity": "",
            }
            pname = p["name"]
            for prefix in ("prvRead", "prvWrite", "prvCreate", "prvDelete",
                           "prvAppend", "prvAppendTo", "prvAssign", "prvShare"):
                if pname.startswith(prefix):
                    p["entity"] = pname[len(prefix):]
                    break
            role["privileges"].append(p)

        # Also check <Privilege> elements
        for priv_el in root.iter("Privilege"):
            p = {
                "privilege_id": priv_el.get("id", ""),
                "name": priv_el.get("name", ""),
                "depth": priv_el.get("level", ""),
                "depth_label": PRIVILEGE_DEPTH_MAP.get(priv_el.get("level", ""), ""),
                "entity": "",
            }
            pname = p["name"]
            for prefix in ("prvRead", "prvWrite", "prvCreate", "prvDelete",
                           "prvAppend", "prvAppendTo", "prvAssign", "prvShare"):
                if pname.startswith(prefix):
                    p["entity"] = pname[len(prefix):]
                    break
            role["privileges"].append(p)

        return role

    # ──────────────────────────────────────────────────────────────────
    # Section 6: Dependencies
    # ──────────────────────────────────────────────────────────────────

    def _build_dependencies(self, result: Dict) -> Dict[str, Any]:
        """Section 6: cross-reference everything."""
        links: List[Dict[str, str]] = []

        # Flow → Table / Flow → Flow
        for flow in result.get("automation", {}).get("cloud_flows", []):
            fref = f"flow:{flow.get('display_name', flow.get('flow_id', ''))}"

            for trig in flow.get("triggers", []):
                if trig.get("dataverse_table"):
                    links.append({
                        "source": fref, "source_type": "Cloud Flow",
                        "target": f"table:{trig['dataverse_table']}", "target_type": "Table",
                        "relationship": "triggered_by",
                        "detail": f"Trigger: {trig.get('name', '')}",
                    })

            for tbl in flow.get("dataverse_tables", []):
                links.append({
                    "source": fref, "source_type": "Cloud Flow",
                    "target": f"table:{tbl['table']}", "target_type": "Table",
                    "relationship": tbl.get("operation", "uses").lower(),
                    "detail": f"Action: {tbl.get('action', '')}",
                })

            for child in flow.get("child_flow_calls", []):
                links.append({
                    "source": fref, "source_type": "Cloud Flow",
                    "target": f"flow:{child.get('child_flow_name', child.get('child_flow_id', ''))}",
                    "target_type": "Cloud Flow",
                    "relationship": "calls",
                    "detail": f"Via: {child.get('action', '')}",
                })

            for conn in flow.get("connectors", []):
                links.append({
                    "source": fref, "source_type": "Cloud Flow",
                    "target": f"connector:{conn.get('name', '')}",
                    "target_type": "Connector",
                    "relationship": "uses_connector", "detail": "",
                })

        # Plugin → Table
        for step in result.get("automation", {}).get("plugin_steps", []):
            if step.get("entity"):
                links.append({
                    "source": f"plugin:{step['name']}", "source_type": "Plugin Step",
                    "target": f"table:{step['entity']}", "target_type": "Table",
                    "relationship": "registered_on",
                    "detail": f"Message: {step.get('message', '')}, Stage: {step.get('stage', '')}",
                })

        # Form → Table, View → Table, Business Rule → Table
        for form in result.get("artifacts", {}).get("forms", []):
            if form.get("entity"):
                links.append({
                    "source": f"form:{form.get('name', form.get('id', ''))}",
                    "source_type": "Form",
                    "target": f"table:{form['entity']}", "target_type": "Table",
                    "relationship": "belongs_to",
                    "detail": f"Type: {form.get('type_label', '')}",
                })
                for field in form.get("fields_on_form", []):
                    links.append({
                        "source": f"form:{form.get('name', '')}",
                        "source_type": "Form",
                        "target": f"column:{form['entity']}.{field['field']}",
                        "target_type": "Column",
                        "relationship": "displays",
                        "detail": f"Tab: {field.get('tab', '')}",
                    })

        for view in result.get("artifacts", {}).get("views", []):
            if view.get("entity"):
                vref = f"view:{view.get('name', view.get('id', ''))}"
                links.append({
                    "source": vref, "source_type": "View",
                    "target": f"table:{view['entity']}", "target_type": "Table",
                    "relationship": "queries", "detail": "",
                })
                for le in view.get("linked_entities", []):
                    if le.get("name"):
                        links.append({
                            "source": vref, "source_type": "View",
                            "target": f"table:{le['name']}", "target_type": "Table",
                            "relationship": "joins",
                            "detail": f"Link: {le.get('link_type', '')}",
                        })

        for br in result.get("artifacts", {}).get("business_rules", []):
            if br.get("entity"):
                links.append({
                    "source": f"businessrule:{br.get('name', '')}", "source_type": "Business Rule",
                    "target": f"table:{br['entity']}", "target_type": "Table",
                    "relationship": "applies_to",
                    "detail": f"Scope: {br.get('scope', '')}",
                })

        # Role → Table
        for role in result.get("security", {}).get("roles", []):
            seen_entities: Set[str] = set()
            for priv in role.get("privileges", []):
                ent = priv.get("entity", "")
                if ent and ent not in seen_entities:
                    seen_entities.add(ent)
                    links.append({
                        "source": f"role:{role['name']}", "source_type": "Security Role",
                        "target": f"table:{ent}", "target_type": "Table",
                        "relationship": "has_privilege",
                        "detail": f"Depth: {priv.get('depth_label', '')}",
                    })

        # Table → Table (relationships)
        for rel in result.get("metadata", {}).get("all_relationships", []):
            target = rel.get("referenced_entity") or rel.get("referencing_entity", "")
            if target:
                links.append({
                    "source": f"table:{rel.get('source_entity', '')}", "source_type": "Table",
                    "target": f"table:{target}", "target_type": "Table",
                    "relationship": f"rel_{rel.get('direction', '')}",
                    "detail": rel.get("name", ""),
                })

        # Bot → Connector (bots likely use Dataverse)
        for bot in result.get("artifacts", {}).get("bots", []):
            links.append({
                "source": f"bot:{bot.get('display_name', bot.get('name', ''))}",
                "source_type": "Bot",
                "target": "connector:Dataverse", "target_type": "Connector",
                "relationship": "may_use", "detail": "Bot detected in solution",
            })

        # Index
        by_source: Dict[str, List] = defaultdict(list)
        by_target: Dict[str, List] = defaultdict(list)
        table_map: Dict[str, Dict[str, List]] = defaultdict(lambda: defaultdict(list))

        for link in links:
            by_source[link["source"]].append(link)
            by_target[link["target"]].append(link)
            if link["target_type"] == "Table":
                tname = link["target"].replace("table:", "")
                table_map[tname][link["source_type"]].append({
                    "component": link["source"],
                    "relationship": link["relationship"],
                })

        # Orphans
        all_sources = set(l["source"] for l in links)
        all_targets = set(l["target"] for l in links)
        orphans = sorted(
            c for c in (all_sources | all_targets)
            if c not in all_targets and not c.startswith("table:") and not c.startswith("connector:")
        )

        return {
            "links": links,
            "by_source": dict(by_source),
            "by_target": dict(by_target),
            "table_dependency_map": {k: dict(v) for k, v in table_map.items()},
            "orphans": orphans,
            "stats": {
                "total_links": len(links),
                "unique_sources": len(all_sources),
                "unique_targets": len(all_targets),
                "tables_referenced": len(table_map),
                "orphans": len(orphans),
            },
        }

    # ──────────────────────────────────────────────────────────────────
    # Summary
    # ──────────────────────────────────────────────────────────────────

    def _build_summary(self, result: Dict) -> Dict[str, Any]:
        """Build a top-level summary of everything parsed."""
        summary: Dict[str, Any] = {}
        for section in ("metadata", "artifacts", "automation", "security", "dependencies"):
            if section in result:
                summary[section] = result[section].get("stats", {})
        return summary

   