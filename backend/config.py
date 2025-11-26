"""
Centralized configuration for TranscriptAI backend
Change port values here to update all backend references
"""
import os
from pathlib import Path

# Load environment variables from config/ports.env if it exists
config_file = Path(__file__).parent.parent / "config" / "ports.env"
if config_file.exists():
    with open(config_file) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value

# Backend Configuration
BACKEND_PORT = int(os.environ.get('BACKEND_PORT', '8001'))
BACKEND_HOST = os.environ.get('BACKEND_HOST', '127.0.0.1')
API_BASE_URL = os.environ.get('API_BASE_URL', f'http://{BACKEND_HOST}:{BACKEND_PORT}')

# Database Configuration
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///./transcriptai.db')

# Logging Configuration
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

def get_uvicorn_command():
    """Generate the uvicorn command with current configuration"""
    return f"uvicorn app.main:app --host {BACKEND_HOST} --port {BACKEND_PORT} --reload"

def get_health_url():
    """Get the health check URL"""
    return f"http://{BACKEND_HOST}:{BACKEND_PORT}/health"

if __name__ == "__main__":
    print(f"Backend Configuration:")
    print(f"  Host: {BACKEND_HOST}")
    print(f"  Port: {BACKEND_PORT}")
    print(f"  API URL: {API_BASE_URL}")
    print(f"  Health URL: {get_health_url()}")
    print(f"  Uvicorn Command: {get_uvicorn_command()}")
