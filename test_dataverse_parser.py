#!/usr/bin/env python3
"""
Test script for Dataverse/PAC Parser

Usage:
    python test_dataverse_parser.py
    python test_dataverse_parser.py --verbose
    python test_dataverse_parser.py --sections metadata artifacts
"""

import sys
import os
import json
from pathlib import Path
import argparse

# Add rag_backend to path
sys.path.insert(0, str(Path(__file__).parent / "rag_backend"))

from pac_parser import PacParser, DataverseParser


def test_pac_parser(zip_path: str = None, verbose: bool = False):
    """Test the full PAC Parser (with CLI)"""
    print("=" * 60)
    print("Testing PacParser (with PAC CLI)")
    print("=" * 60)
    
    parser = PacParser()
    
    # Check if PAC CLI is available
    print(f"\n✓ PAC CLI Available: {parser.pac_available}")
    if parser.pac_path:
        print(f"  Path: {parser.pac_path}")
    else:
        print("  ⚠️  PAC CLI not found - will use fallback parser")
    
    # Use default test solution if not provided
    if not zip_path:
        zip_path = "pac-workspace/solution.zip"
        if not os.path.exists(zip_path):
            print(f"\n❌ No solution zip found at {zip_path}")
            print("   Please provide a solution zip path:")
            print("   python test_dataverse_parser.py --zip /path/to/solution.zip")
            return None
    
    print(f"\n📦 Testing with: {zip_path}")
    
    try:
        # Create temporary directory for extraction
        import tempfile
        with tempfile.TemporaryDirectory() as temp_dir:
            result = parser.parse_solution(zip_path, temp_dir)
            
            print("\n" + "=" * 60)
            print("PARSE RESULTS")
            print("=" * 60)
            
            print(f"\n📋 Solution Name: {result.get('name', 'N/A')}")
            print(f"   Version: {result.get('version', 'N/A')}")
            print(f"   Publisher: {result.get('publisher', 'N/A')}")
            
            components = result.get('components', [])
            print(f"\n📊 Components Found: {len(components)}")
            
            # Group by type
            by_type = {}
            for comp in components:
                comp_type = comp.get('type', 'unknown')
                by_type.setdefault(comp_type, []).append(comp)
            
            for comp_type, items in sorted(by_type.items()):
                print(f"   • {comp_type}: {len(items)}")
                if verbose:
                    for item in items[:3]:  # Show first 3
                        print(f"      - {item.get('name', 'N/A')}")
                    if len(items) > 3:
                        print(f"      ... and {len(items) - 3} more")
            
            if verbose:
                print("\n" + "=" * 60)
                print("FULL JSON OUTPUT")
                print("=" * 60)
                print(json.dumps(result, indent=2))
            
            return result
            
    except Exception as e:
        print(f"\n❌ Error during parsing: {e}")
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def test_dataverse_parser(extract_dir: str = None, sections: list = None, verbose: bool = False):
    """Test the DataverseParser (direct) on already extracted solution"""
    print("\n" + "=" * 60)
    print("Testing DataverseParser (on extracted files)")
    print("=" * 60)
    
    # Use default extracted directory if not provided
    if not extract_dir:
        extract_dir = "pac-workspace/extracted"
        if not os.path.exists(extract_dir):
            print(f"\n❌ No extracted solution found at {extract_dir}")
            print("   First run PAC CLI to extract a solution, or provide path:")
            print("   python test_dataverse_parser.py --extract-dir /path/to/extracted")
            return None
    
    print(f"\n📁 Testing with: {extract_dir}")
    
    try:
        parser = DataverseParser(extract_dir, verbose=verbose)
        result = parser.parse_all(sections=sections)
        
        print("\n" + "=" * 60)
        print("COMPREHENSIVE PARSE RESULTS")
        print("=" * 60)
        
        # Solution info
        solution = result.get('solution', {})
        print(f"\n📋 Solution: {solution.get('name', 'N/A')}")
        print(f"   Version: {solution.get('version', 'N/A')}")
        print(f"   Publisher: {solution.get('publisher', 'N/A')}")
        
        # Folder inventory
        inventory = result.get('folder_inventory', {})
        print(f"\n📂 Folders: {len(inventory.get('folders', {}))}")
        for folder, info in inventory.get('folders', {}).items():
            print(f"   • {folder}: {info.get('file_count', 0)} files")
        
        # Summary stats
        summary = result.get('summary', {})
        print(f"\n📊 Summary:")
        if 'entities' in summary:
            print(f"   • Entities (Tables): {summary['entities']}")
        if 'workflows' in summary:
            print(f"   • Workflows: {summary['workflows']}")
        if 'canvas_apps' in summary:
            print(f"   • Canvas Apps: {summary['canvas_apps']}")
        if 'flows' in summary:
            print(f"   • Flows: {summary['flows']}")
        if 'bots' in summary:
            print(f"   • Bots: {summary['bots']}")
        if 'roles' in summary:
            print(f"   • Security Roles: {summary['roles']}")
        if 'connections' in summary:
            print(f"   • Connections: {summary['connections']}")
        
        # Section details
        print(f"\n📝 Parsed Sections: {', '.join(result.get('sections', []))}")
        
        if verbose:
            print("\n" + "=" * 60)
            print("FULL JSON OUTPUT")
            print("=" * 60)
            print(json.dumps(result, indent=2, default=str))
        
        return result
        
    except Exception as e:
        print(f"\n❌ Error during parsing: {e}")
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def run_validation_checks(result: dict):
    """Run validation checks on parsed results"""
    print("\n" + "=" * 60)
    print("VALIDATION CHECKS")
    print("=" * 60)
    
    checks_passed = 0
    checks_total = 0
    
    # Check 1: Solution name exists
    checks_total += 1
    if result.get('solution', {}).get('name') and result['solution']['name'] != 'Unknown':
        print("✓ Solution name parsed successfully")
        checks_passed += 1
    else:
        print("✗ Solution name missing or invalid")
    
    # Check 2: At least some folders found
    checks_total += 1
    folders = result.get('folder_inventory', {}).get('folders', {})
    if folders:
        print(f"✓ Found {len(folders)} component folders")
        checks_passed += 1
    else:
        print("✗ No component folders found")
    
    # Check 3: Summary exists
    checks_total += 1
    summary = result.get('summary', {})
    if summary:
        print(f"✓ Summary generated with {len(summary)} metrics")
        checks_passed += 1
    else:
        print("✗ Summary missing")
    
    # Check 4: Parsed timestamp
    checks_total += 1
    if result.get('parsed_at'):
        print(f"✓ Parse timestamp: {result['parsed_at']}")
        checks_passed += 1
    else:
        print("✗ Parse timestamp missing")
    
    print(f"\n{'='*60}")
    print(f"Validation: {checks_passed}/{checks_total} checks passed")
    print(f"{'='*60}")
    
    return checks_passed == checks_total


def main():
    parser = argparse.ArgumentParser(description='Test Dataverse/PAC Parser')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output with full JSON')
    parser.add_argument('--zip', type=str, help='Path to solution.zip file')
    parser.add_argument('--extract-dir', type=str, help='Path to extracted solution directory')
    parser.add_argument('--sections', nargs='+', 
                       choices=['metadata', 'artifacts', 'automation', 'security', 'dependencies'],
                       help='Specific sections to parse (DataverseParser only)')
    parser.add_argument('--mode', choices=['pac', 'dataverse', 'both'], default='both',
                       help='Which parser to test')
    
    args = parser.parse_args()
    
    print("\n🧪 DATAVERSE PARSER TEST SUITE")
    print("=" * 60)
    
    results = {}
    all_passed = True
    
    # Test PacParser
    if args.mode in ['pac', 'both']:
        pac_result = test_pac_parser(zip_path=args.zip, verbose=args.verbose)
        if pac_result:
            results['pac'] = pac_result
        else:
            all_passed = False
    
    # Test DataverseParser
    if args.mode in ['dataverse', 'both']:
        dv_result = test_dataverse_parser(
            extract_dir=args.extract_dir, 
            sections=args.sections,
            verbose=args.verbose
        )
        if dv_result:
            results['dataverse'] = dv_result
            # Run validation
            if not run_validation_checks(dv_result):
                all_passed = False
        else:
            all_passed = False
    
    # Final summary
    print("\n" + "=" * 60)
    if all_passed and results:
        print("✅ ALL TESTS PASSED")
    elif results:
        print("⚠️  TESTS COMPLETED WITH WARNINGS")
    else:
        print("❌ TESTS FAILED")
    print("=" * 60 + "\n")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
