#!/usr/bin/env python3
"""
Test script to verify SignalHub Phase 0 setup.
"""
import os
import sys
import requests
import time
from pathlib import Path


def test_file_structure():
    """Test that all required files exist."""
    print("📁 Testing file structure...")
    
    required_files = [
        "requirements.txt",
        "backend/app/main.py",
        "backend/app/config.py",
        "backend/app/database.py",
        "backend/app/models.py",
        "backend/test_main.py",
        "env.example",
        ".gitignore",
        "README.md"
    ]
    
    required_dirs = [
        "backend",
        "backend/app",
        "audio_uploads",
        "logs"
    ]
    
    all_good = True
    
    for file_path in required_files:
        if os.path.exists(file_path):
            print(f"✅ {file_path}")
        else:
            print(f"❌ {file_path} - MISSING")
            all_good = False
    
    for dir_path in required_dirs:
        if os.path.exists(dir_path):
            print(f"✅ {dir_path}/")
        else:
            print(f"❌ {dir_path}/ - MISSING")
            all_good = False
    
    return all_good


def test_imports():
    """Test that all modules can be imported."""
    print("\n📦 Testing imports...")
    
    try:
        from backend.app.config import settings
        print("✅ config.py imports successfully")
    except Exception as e:
        print(f"❌ config.py import failed: {e}")
        return False
    
    try:
        from backend.app.database import get_db, create_tables
        print("✅ database.py imports successfully")
    except Exception as e:
        print(f"❌ database.py import failed: {e}")
        return False
    
    try:
        from backend.app.models import User, Call, Transcript, Analysis
        print("✅ models.py imports successfully")
    except Exception as e:
        print(f"❌ models.py import failed: {e}")
        return False
    
    return True


def test_fastapi_app():
    """Test that FastAPI app can be created."""
    print("\n🚀 Testing FastAPI app...")
    
    try:
        from backend.app.main import app
        print("✅ FastAPI app created successfully")
        
        # Test that app has expected attributes
        if hasattr(app, 'routes'):
            print("✅ App has routes")
        else:
            print("❌ App missing routes")
            return False
            
        return True
    except Exception as e:
        print(f"❌ FastAPI app creation failed: {e}")
        return False


def test_api_endpoints():
    """Test API endpoints if server is running."""
    print("\n🌐 Testing API endpoints...")
    
    base_url = "http://localhost:8001"
    
    try:
        # Test root endpoint
        response = requests.get(f"{base_url}/", timeout=5)
        if response.status_code == 200:
            print("✅ Root endpoint (/) - OK")
        else:
            print(f"❌ Root endpoint (/) - Status: {response.status_code}")
            return False
        
        # Test health endpoint
        response = requests.get(f"{base_url}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Health endpoint (/health) - OK")
        else:
            print(f"❌ Health endpoint (/health) - Status: {response.status_code}")
            return False
        
        # Test API status endpoint
        response = requests.get(f"{base_url}/api/v1/status", timeout=5)
        if response.status_code == 200:
            print("✅ API status endpoint (/api/v1/status) - OK")
        else:
            print(f"❌ API status endpoint (/api/v1/status) - Status: {response.status_code}")
            return False
        
        # Test calls endpoint
        response = requests.get(f"{base_url}/api/v1/calls", timeout=5)
        if response.status_code == 200:
            print("✅ Calls endpoint (/api/v1/calls) - OK")
        else:
            print(f"❌ Calls endpoint (/api/v1/calls) - Status: {response.status_code}")
            return False
        
        return True
        
    except requests.exceptions.ConnectionError:
        print("⚠️ Server not running. Start with: python -m uvicorn backend.app.main:app --reload")
        return False
    except Exception as e:
        print(f"❌ API test failed: {e}")
        return False


def test_database_connection():
    """Test database connection."""
    print("\n🗄️ Testing database connection...")
    
    try:
        from backend.app.database import engine
        from sqlalchemy import text
        
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("✅ Database connection successful")
            return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("💡 Make sure PostgreSQL is running and database is created")
        return False


def main():
    """Main test function."""
    print("🧪 SignalHub Phase 0 Setup Test")
    print("=" * 50)
    
    tests = [
        ("File Structure", test_file_structure),
        ("Module Imports", test_imports),
        ("FastAPI App", test_fastapi_app),
        ("Database Connection", test_database_connection),
        ("API Endpoints", test_api_endpoints)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"\n🔍 Running {test_name} test...")
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} test failed with exception: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 Test Results Summary")
    print("=" * 50)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Phase 0 setup is complete.")
    else:
        print("⚠️ Some tests failed. Please check the issues above.")
        
        if not any(name == "API Endpoints" and result for name, result in results):
            print("\n💡 To start the server:")
            print("   python -m uvicorn backend.app.main:app --reload")
        
        if not any(name == "Database Connection" and result for name, result in results):
            print("\n💡 To set up the database:")
            print("   1. Install PostgreSQL")
            print("   2. Create database: createdb signalhub")
            print("   3. Create user: createuser signalhub")
            print("   4. Set password for signalhub user")
            print("   5. Update .env file with correct credentials")


if __name__ == "__main__":
    main()
