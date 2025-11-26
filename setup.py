#!/usr/bin/env python3
"""
Setup script for TranscriptAI Phase 0.
"""
import os
import sys
import subprocess
from pathlib import Path


def run_command(command, description):
    """Run a command and handle errors."""
    print(f"🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed: {e}")
        print(f"Error output: {e.stderr}")
        return False


def check_python_version():
    """Check if Python version is compatible."""
    print("🐍 Checking Python version...")
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 9):
        print(f"❌ Python 3.9+ required, found {version.major}.{version.minor}")
        return False
    print(f"✅ Python {version.major}.{version.minor}.{version.micro} is compatible")
    return True


def create_directories():
    """Create necessary directories."""
    print("📁 Creating directories...")
    directories = [
        "audio_uploads",
        "logs",
        "backend/app"
    ]
    
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"✅ Created directory: {directory}")


def create_env_file():
    """Create .env file from template."""
    print("⚙️ Setting up environment file...")
    if not os.path.exists(".env"):
        if os.path.exists("env.example"):
            with open("env.example", "r") as f:
                content = f.read()
            with open(".env", "w") as f:
                f.write(content)
            print("✅ Created .env file from template")
        else:
            print("⚠️ env.example not found, creating basic .env file")
            with open(".env", "w") as f:
                f.write("DATABASE_URL=postgresql://transcriptai:transcriptai123@localhost:5432/transcriptai\n")
                f.write("DEBUG=True\n")
                f.write("SECRET_KEY=your-secret-key-here-change-in-production\n")
            print("✅ Created basic .env file")
    else:
        print("✅ .env file already exists")


def main():
    """Main setup function."""
    print("🚀 TranscriptAI Phase 0 Setup")
    print("=" * 50)
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Create directories
    create_directories()
    
    # Create environment file
    create_env_file()
    
    # Install dependencies
    if not run_command("pip install -r requirements.txt", "Installing Python dependencies"):
        print("❌ Failed to install dependencies. Please check your Python environment.")
        sys.exit(1)
    
    print("\n🎉 Setup completed successfully!")
    print("\n📋 Next steps:")
    print("1. Set up PostgreSQL database:")
    print("   - Create database: createdb transcriptai")
    print("   - Create user: createuser transcriptai")
    print("   - Set password for transcriptai user")
    print("2. Update .env file with your database credentials")
    print("3. Run the application: python -m uvicorn backend.app.main:app --reload")
    print("4. Test the API: curl http://localhost:8001/health")
    print("5. View documentation: http://localhost:8001/docs")


if __name__ == "__main__":
    main()
