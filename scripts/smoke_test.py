import subprocess
import time
import sys
import os
from pathlib import Path

def test_backend_binary():
    """
    Runs the built backend binary for a few seconds to verify it starts.
    Catches immediate startup errors like 'ModuleNotFoundError'.
    """
    # 1. Locate Binary
    project_root = Path(__file__).parent.parent
    binary_path = project_root / "backend" / "bin" / "transcriptai-backend" / "transcriptai-backend"
    
    if not binary_path.exists():
        # Fallback to exe for Windows if needed, though we are on Mac
        binary_path = project_root / "backend" / "bin" / "transcriptai-backend" / "transcriptai-backend.exe"
    
    if not binary_path.exists():
        print(f"❌ FAIL: Binary not found at {binary_path}")
        print("   Did you run 'bash backend/build-backend.sh' yet?")
        sys.exit(1)

    print(f"🧪 Testing Binary: {binary_path}")

    # 2. Run it
    # We set environment variables to ensure it behaves like production
    env = os.environ.copy()
    env["TRANSCRIPTAI_MODE"] = "desktop"
    env["TRANSCRIPTAI_PORT"] = "0"  # Let it pick a random port
    
    try:
        # Start the process
        # We don't need to pipe stdin, just capture stdout/stderr to diagnose
        process = subprocess.Popen(
            [str(binary_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )
        
        print("   Process started (PID: {})... waiting 5 seconds...".format(process.pid))
        
        # Simple wait
        time.sleep(5)
        
        # Check if it is still running
        return_code = process.poll()
        
        if return_code is not None:
             # It exited!
            stdout, stderr = process.communicate()
            print(f"❌ FAIL: Process crashed immediately with exit code {return_code}")
            print("-" * 20 + " STDOUT " + "-" * 20)
            print(stdout)
            print("-" * 20 + " STDERR " + "-" * 20)
            print(stderr)
            sys.exit(1)
            
        else:
            # Still running
            print("✅ SUCCESS: Process is still running after 5 seconds.")
            process.terminate()
            try:
                process.wait(timeout=2)
            except:
                process.kill()
            sys.exit(0)

    except Exception as e:
        print(f"❌ ERROR: Failed to run test: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_backend_binary()
