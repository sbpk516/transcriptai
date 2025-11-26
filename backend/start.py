#!/usr/bin/env python3
"""
Start backend server using port from config.js
This script reads the port configuration from the centralized config.js file
"""
import os
import re
import subprocess
import sys
from pathlib import Path

def get_backend_port():
    """Get backend port from config.js file"""
    config_file = Path(__file__).parent.parent / "config.js"
    
    if not config_file.exists():
        print("❌ config.js not found, using default port 8001")
        return "8001"
    
    try:
        with open(config_file, 'r') as f:
            content = f.read()
            
        # Extract BACKEND_PORT from JavaScript config
        match = re.search(r'BACKEND_PORT:\s*(\d+)', content)
        if match:
            port = match.group(1)
            print(f"✅ Found backend port: {port}")
            return port
        else:
            print("❌ BACKEND_PORT not found in config.js, using default port 8001")
            return "8001"
            
    except Exception as e:
        print(f"❌ Error reading config.js: {e}")
        print("Using default port 8001")
        return "8001"

def main():
    """Main function to start the backend server"""
    port = get_backend_port()
    
    print(f"🚀 Starting TranscriptAI backend on port {port}")
    print(f"📍 Health check: http://127.0.0.1:{port}/health")
    print(f"📚 API docs: http://127.0.0.1:{port}/docs")
    print("-" * 50)
    
    # Start uvicorn server
    cmd = [
        sys.executable, "-m", "uvicorn", 
        "app.main:app", 
        "--host", "127.0.0.1",
        "--port", port,
        "--reload"
    ]
    
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n🛑 Backend server stopped")
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
