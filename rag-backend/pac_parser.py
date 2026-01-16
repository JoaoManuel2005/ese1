import subprocess
import os
import json
import xml.etree.ElementTree as ET
from typing import Dict, List, Any
import zipfile

class PacParser:
    """Parser for Power Platform solution files using PAC CLI"""
    
    def __init__(self):
        # Try to find PAC CLI in common locations
        self.pac_path = self._find_pac_cli()
        self.pac_available = self.pac_path is not None
    
    def _find_pac_cli(self) -> str:
        """Find PAC CLI executable"""
        # Common PAC CLI locations
        possible_paths = [
            os.path.expanduser("~/.dotnet/tools/pac"),  # Default .NET tools location (check first)
            "pac",  # In PATH
            "/usr/local/bin/pac",
            "/opt/homebrew/bin/pac",
        ]
        
        # First, just check if the file exists (faster than running --version)
        for pac_path in possible_paths:
            expanded_path = os.path.expanduser(pac_path) if pac_path.startswith("~") else pac_path
            if os.path.exists(expanded_path) and os.access(expanded_path, os.X_OK):
                print(f"✓ Found PAC CLI at: {expanded_path}")
                return expanded_path
        
        print("Warning: PAC CLI not found. Using fallback XML parsing.")
        return None
    
    def parse_solution(self, zip_path: str, temp_dir: str) -> Dict[str, Any]:
        """Parse a Power Platform solution zip file"""
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        
        if self.pac_available:
            return self._parse_with_pac_cli(zip_path, extract_dir)
        else:
            return self._parse_with_fallback(zip_path, extract_dir)
    
    def _parse_with_pac_cli(self, zip_path: str, extract_dir: str) -> Dict[str, Any]:
        """Use PAC CLI to unpack and parse solution"""
        try:
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
        """Parse an unpacked solution directory"""
        solution_data = {
            "name": "Unknown Solution",
            "version": "1.0.0",
            "publisher": "Unknown",
            "components": []
        }
        
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
        
        for solution_xml_path in solution_xml_paths:
            if os.path.exists(solution_xml_path):
                print(f"Found solution.xml at: {solution_xml_path}")
                parsed = self._parse_solution_xml(solution_xml_path)
                if parsed.get("name") and parsed.get("name") != "Unknown":
                    solution_data.update(parsed)
                    break
        
        # Parse all component types
        self._parse_directory(extract_dir, "Workflows", "flow", solution_data)
        self._parse_directory(extract_dir, "CanvasApps", "canvasapp", solution_data)
        self._parse_directory(extract_dir, "Entities", "entity", solution_data)
        self._parse_directory(extract_dir, "WebResources", "webresource", solution_data)
        self._parse_directory(extract_dir, "PluginAssemblies", "plugin", solution_data)
        self._parse_directory(extract_dir, "Reports", "report", solution_data)
        
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
