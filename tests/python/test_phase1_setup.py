#!/usr/bin/env python3
"""
Phase 1 Setup Test Script
Tests all components needed for Phase 1: Audio Ingestion
"""
import sys
import os
import json
from pathlib import Path

def test_phase0_foundation():
    """Test that Phase 0 foundation is still working."""
    print("🔍 Testing Phase 0 Foundation...")
    
    try:
        # Test imports
        from backend.app.config import settings
        from backend.app.database import get_db, create_tables
        from backend.app.models import User, Call, Transcript, Analysis
        print("✅ All Phase 0 imports working")
        
        # Test database connection
        from sqlalchemy import text
        db = next(get_db())
        db.execute(text("SELECT 1"))
        db.close()
        print("✅ Database connection working")
        
        return True
    except Exception as e:
        print(f"❌ Phase 0 foundation test failed: {e}")
        return False

def test_phase1_dependencies():
    """Test Phase 1 dependencies."""
    print("\n🔍 Testing Phase 1 Dependencies...")
    
    dependencies = {
        "python-multipart": False,
        "aiofiles": False,
        "ffmpeg-python": False,
        "openai-whisper": False,
        "librosa": False,
        "numpy": False
    }
    
    # Test each dependency
    for dep, installed in dependencies.items():
        try:
            if dep == "python-multipart":
                import multipart
            elif dep == "aiofiles":
                import aiofiles
            elif dep == "ffmpeg-python":
                import ffmpeg
            elif dep == "openai-whisper":
                import whisper
            elif dep == "librosa":
                import librosa
            elif dep == "numpy":
                import numpy
            
            dependencies[dep] = True
            print(f"✅ {dep} - Installed")
        except ImportError:
            print(f"❌ {dep} - Not installed")
    
    return dependencies

def test_system_requirements():
    """Test system requirements."""
    print("\n🔍 Testing System Requirements...")
    
    from backend.app.debug_utils import check_system_requirements
    
    requirements = check_system_requirements()
    
    print(f"FFmpeg: {'✅' if requirements['ffmpeg'] else '❌'}")
    print(f"Whisper: {'✅' if requirements['whisper'] else '❌'}")
    print(f"Audio Libraries: {'✅' if requirements['audio_libraries'] else '❌'}")
    print(f"Disk Space: {'✅' if requirements['disk_space'] else '❌'} ({requirements.get('disk_space_gb', 'unknown')}GB free)")
    
    return requirements

def test_file_structure():
    """Test required file structure for Phase 1."""
    print("\n🔍 Testing File Structure...")
    
    required_dirs = [
        "audio_uploads",
        "logs",
        "debug_logs",
        "test_files"
    ]
    
    required_files = [
        "backend/app/logging_config.py",
        "backend/app/debug_utils.py"
    ]
    
    # Create directories
    for dir_name in required_dirs:
        Path(dir_name).mkdir(exist_ok=True)
        print(f"✅ Directory: {dir_name}")
    
    # Check files
    for file_path in required_files:
        if Path(file_path).exists():
            print(f"✅ File: {file_path}")
        else:
            print(f"❌ File missing: {file_path}")
    
    return True

def test_logging_setup():
    """Test logging configuration."""
    print("\n🔍 Testing Logging Setup...")
    
    try:
        from backend.app.logging_config import setup_logging
        loggers = setup_logging()
        
        # Test logging
        logger = loggers['signalhub.api']
        logger.info("Test log message")
        print("✅ Logging setup working")
        
        return True
    except Exception as e:
        print(f"❌ Logging setup failed: {e}")
        return False

def test_debug_utils():
    """Test debugging utilities."""
    print("\n🔍 Testing Debug Utilities...")
    
    try:
        from backend.app.debug_utils import debug_helper, validate_file_upload
        
        # Test debug helper
        debug_helper.log_debug_info("test_operation", {"test": "data"})
        print("✅ Debug helper working")
        
        # Test file validation (with mock file)
        class MockFile:
            def __init__(self):
                self.filename = "test.wav"
                self.content = b"test content"
            
            def seek(self, offset, whence=0):
                pass
            
            def tell(self):
                return len(self.content)
        
        mock_file = MockFile()
        validation = validate_file_upload(mock_file, [".wav"], 1024*1024)
        print("✅ File validation working")
        
        return True
    except Exception as e:
        print(f"❌ Debug utilities test failed: {e}")
        return False

def generate_phase1_report():
    """Generate a comprehensive Phase 1 readiness report."""
    print("\n" + "="*60)
    print("📊 PHASE 1 READINESS REPORT")
    print("="*60)
    
    # Run all tests
    phase0_ok = test_phase0_foundation()
    dependencies = test_phase1_dependencies()
    requirements = test_system_requirements()
    structure_ok = test_file_structure()
    logging_ok = test_logging_setup()
    debug_ok = test_debug_utils()
    
    # Calculate readiness score
    total_tests = 6
    passed_tests = sum([
        phase0_ok,
        all(dependencies.values()),
        all([requirements["ffmpeg"], requirements["whisper"], requirements["disk_space"]]),
        structure_ok,
        logging_ok,
        debug_ok
    ])
    
    readiness_percentage = (passed_tests / total_tests) * 100
    
    print(f"\n🎯 READINESS SCORE: {readiness_percentage:.1f}%")
    
    if readiness_percentage >= 80:
        print("✅ READY FOR PHASE 1 IMPLEMENTATION!")
    elif readiness_percentage >= 60:
        print("⚠️  MOSTLY READY - Some dependencies missing")
    else:
        print("❌ NOT READY - Fix issues before proceeding")
    
    # Recommendations
    print("\n📋 RECOMMENDATIONS:")
    
    if not dependencies["python-multipart"]:
        print("- Install: pip install python-multipart")
    
    if not dependencies["aiofiles"]:
        print("- Install: pip install aiofiles")
    
    if not requirements["ffmpeg"]:
        print("- Install FFmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)")
    
    if not requirements["whisper"]:
        print("- Install: pip install openai-whisper")
    
    if not requirements["disk_space"]:
        print("- Free up disk space (need at least 1GB)")
    
    return readiness_percentage >= 80

if __name__ == "__main__":
    print("🚀 SignalHub Phase 1 Setup Test")
    print("="*40)
    
    ready = generate_phase1_report()
    
    if ready:
        print("\n🎉 You're ready to start Phase 1 implementation!")
        print("Next step: Start with file upload endpoints")
    else:
        print("\n🔧 Please fix the issues above before proceeding")
    
    sys.exit(0 if ready else 1)
