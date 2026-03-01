#!/usr/bin/env python3
"""Test enhanced dvtablesearchentities parsing"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "rag_backend"))
from pac_parser import DataverseParser

p = DataverseParser('pac-workspace/extracted')
r = p.parse_all(sections=['artifacts'])

print('='*60)
print('ENHANCED DVTABLESEARCHENTITIES PARSING')
print('='*60)

entities = r['artifacts']['dv_search_entities']
print(f'\n✅ Found {len(entities)} search-enabled entity(ies)\n')

for entity in entities:
    print(f'📊 Entity: {entity.get("name", "N/A")}')
    print(f'   🆔 Entity ID: {entity.get("id", "N/A")}')
    print(f'   🔗 Linked Search ID: {entity.get("dvtablesearch_id", "N/A")}')
    print(f'   📋 Entity Logical Name: {entity.get("entity_logical_name", "N/A")}')
    print(f'   📊 State Code: {entity.get("state_code", "N/A")}')
    print(f'   📊 Status Code: {entity.get("status_code", "N/A")}')
    print(f'   🔧 Customizable: {entity.get("is_customizable", False)}')
    print()

print('='*60)
print('✅ PARSING COMPLETE')
print('='*60)

# Show how it links to dvtablesearch
searches = r['artifacts']['dv_searches']
if searches and entities:
    print('\n🔗 LINKING VALIDATION:')
    for entity in entities:
        search_id = entity.get('dvtablesearch_id')
        matching_search = next((s for s in searches if s.get('id') == search_id), None)
        if matching_search:
            print(f'   ✅ Entity "{entity.get("name")}" -> Search "{matching_search.get("name")}"')
