#!/usr/bin/env python3
"""Check what Dataverse tables are used in your solution"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "rag_backend"))
from pac_parser import DataverseParser

def main():
    parser = DataverseParser('pac-workspace/extracted')
    result = parser.parse_all()
    
    print("\n" + "="*60)
    print("DATAVERSE TABLES IN YOUR SOLUTION")
    print("="*60)
    
    # Check custom tables
    metadata = result.get('metadata', {})
    custom_tables = metadata.get('tables', [])
    
    print(f"\n📦 Custom Dataverse Tables: {len(custom_tables)}")
    if custom_tables:
        for table in custom_tables:
            name = table.get('logical_name', 'N/A')
            display = table.get('display_name', 'N/A')
            attrs = len(table.get('attributes', []))
            print(f"  • {name}")
            if display:
                print(f"    Display: {display}")
            print(f"    Fields: {attrs}")
    else:
        print("  ℹ️  No custom tables found")
    
    # Check what flows reference
    automation = result.get('automation', {})
    flows = automation.get('cloud_flows', [])
    
    print(f"\n⚡ Cloud Flows: {len(flows)}")
    
    all_tables = {}
    for flow in flows:
        flow_name = flow.get('name') or flow.get('id', 'Unknown')[:50]
        tables = flow.get('dataverse_tables', [])
        
        if tables:
            print(f"\n  Flow: {flow_name}")
            for t in tables:
                table = t.get('table', 'Unknown')
                op = t.get('operation', 'Unknown')
                print(f"    -> {table} ({op})")
                
                if table not in all_tables:
                    all_tables[table] = {'count': 0, 'operations': set()}
                all_tables[table]['count'] += 1
                all_tables[table]['operations'].add(op)
    
    if all_tables:
        print("\n" + "="*60)
        print(f"📋 ALL DATAVERSE TABLES USED ({len(all_tables)} tables):")
        print("="*60)
        for table, info in sorted(all_tables.items()):
            ops = ', '.join(sorted(info['operations']))
            print(f"\n  {table}")
            print(f"    Used {info['count']} times")
            print(f"    Operations: {ops}")
    else:
        print("\n  ℹ️  No flows reference Dataverse tables")
    
    # Summary
    print("\n" + "="*60)
    print("SOLUTION SUMMARY")
    print("="*60)
    summary = result.get('summary', {})
    print(f"  Canvas Apps: {summary.get('artifacts', {}).get('canvas_apps', 0)}")
    print(f"  Bots: {summary.get('artifacts', {}).get('bots', 0)}")
    print(f"  Cloud Flows: {summary.get('automation', {}).get('cloud_flows', 0)}")
    print(f"  Custom Tables: {summary.get('metadata', {}).get('tables', 0)}")
    print()

if __name__ == "__main__":
    main()
