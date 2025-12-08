#!/usr/bin/env python3
"""
Verify the bundled backend by attempting to import critical modules.
Run this script using the BUNDLED python environment.
"""
import sys
import os
import platform
import importlib
import traceback

def test_import(module_name):
    print(f"Testing import: {module_name}...", end=" ", flush=True)
    try:
        importlib.import_module(module_name)
        print("✅ OK")
        return True
    except Exception as e:
        print("❌ FAILED")
        print(f"Error importing {module_name}: {e}")
        traceback.print_exc()
        return False

def main():
    print(f"--- Backend Bundle Verification ({platform.system()} {platform.machine()}) ---")
    print(f"Python: {sys.version}")
    print(f"Executable: {sys.executable}")
    
    # Set RTLD_GLOBAL if not already set, just in case (for torch)
    if platform.system() == "Darwin":
        # This might be too late if already imported, but good for subprocesses
        pass 

    # Critical dependencies
    critical_modules = [
        "fastapi",
        "uvicorn", 
        "pydantic",
        "numpy",
        "torch",        # The one crashing
        "whisper"
    ]
    
    failed = []
    for mod in critical_modules:
        if not test_import(mod):
            failed.append(mod)
            
    if failed:
        print(f"\n❌ Verification FAILED. Could not import: {', '.join(failed)}")
        sys.exit(1)
        
    print("\n✅ Verification PASSED. All critical modules imported.")
    sys.exit(0)

if __name__ == "__main__":
    main()
