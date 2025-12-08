#!/usr/bin/env python3
"""
Start backend server using port from config.js
This script reads the port configuration from the centralized config.js file
"""
import os
import re
import subprocess
import sys
import time
import logging
from pathlib import Path

# Set up logging for startup timing
logging.basicConfig(
    level=logging.INFO,
    format='[WEB_STARTUP] %(message)s'
)
logger = logging.getLogger(__name__)

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
    _WEB_STARTUP_START = time.perf_counter()
    _WEB_STARTUP_TIMESTAMP = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    logger.info(f"phase=backend_script_start timestamp={_WEB_STARTUP_TIMESTAMP}")
    
    _PORT_READ_START = time.perf_counter()
    port = get_backend_port()
    _PORT_READ_ELAPSED = (time.perf_counter() - _PORT_READ_START) * 1000
    logger.info(f"phase=port_config_read elapsed={_PORT_READ_ELAPSED:.3f}ms port={port}")
    
    print(f"🚀 Starting TranscriptAI backend on port {port}")
    print(f"📍 Health check: http://127.0.0.1:{port}/health")
    print(f"📚 API docs: http://127.0.0.1:{port}/docs")
    print("-" * 50)
    
    # Start uvicorn server
    _UVICORN_SPAWN_START = time.perf_counter()
    cmd = [
        sys.executable, "-m", "uvicorn", 
        "app.main:app", 
        "--host", "127.0.0.1",
        "--port", port,
        "--reload"
    ]
    logger.info(f"phase=uvicorn_spawn_start timestamp={time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime())}")
    
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n🛑 Backend server stopped")
    except Exception as e:
        _WEB_STARTUP_ERROR_ELAPSED = (time.perf_counter() - _WEB_STARTUP_START) * 1000
        logger.error(f"phase=backend_script_error elapsed={_WEB_STARTUP_ERROR_ELAPSED:.3f}ms error={str(e)}")
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
