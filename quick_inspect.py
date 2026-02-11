#!/usr/bin/env python3
"""
Quick inspection script to see what DataverseParser finds in your solution
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "rag_backend"))

from pac_parser import DataverseParser

# Point to your extracted solution
extract_dir = "pac-workspace/extracted"

parser = DataverseParser(extract_dir, verbose=True)

# Parse all sections
result = parser.parse_all()

# Quick checks
print("\n" + "="*60)
print("QUICK INSPECTION")
print("="*60)

print(f"\nSolution: {result.get('solution', {}).get('name')}")

# Check what folders exist
folders = result.get('folder_inventory', {}).get('folders', {})
print(f"\nFolders found: {list(folders.keys())}")

# Check summary
summary = result.get('summary', {})
print(f"\nComponents:")
for key, value in summary.items():
    if isinstance(value, (int, str)):
        print(f"  {key}: {value}")

# Check for specific elements you care about
if 'artifacts' in result:
    artifacts = result['artifacts']
    print(f"\n📦 Artifacts:")
    print(f"  Entities: {len(artifacts.get('entities', []))}")
    print(f"  Canvas Apps: {len(artifacts.get('canvas_apps', []))}")

if 'automation' in result:
    automation = result['automation']
    print(f"\n⚙️  Automation:")
    print(f"  Workflows: {len(automation.get('workflows', []))}")
    print(f"  Flows: {len(automation.get('flows', []))}")

if 'security' in result:
    security = result['security']
    print(f"\n🔒 Security:")
    print(f"  Roles: {len(security.get('roles', []))}")

if 'dependencies' in result:
    deps = result['dependencies']
    print(f"\n🔗 Dependencies:")
    print(f"  Relationships: {len(deps.get('relationships', []))}")
    print(f"  Connections: {len(deps.get('connections', []))}")
