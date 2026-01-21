#!/usr/bin/env python3
"""
Programmatic test to verify media_type normalization fix.
This tests the exact issue that was failing.
"""

import sys
import os

# Add backend to path
backend_path = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, backend_path)

from fastapi.testclient import TestClient
import base64

# Import the app
from backend.app.main import app

client = TestClient(app)

def test_media_type_with_codec_parameter():
    """
    Test that backend accepts 'audio/webm;codecs=opus' 
    (the exact format sent by the frontend)
    """
    # Create a minimal audio payload
    test_audio = b'\x00' * 1000  # Fake audio data
    audio_base64 = base64.b64encode(test_audio).decode('utf-8')
    
    # This is the EXACT payload the frontend sends
    payload = {
        "audio_base64": audio_base64,
        "media_type": "audio/webm;codecs=opus",  # With codec info!
        "duration_ms": 1000,
        "size_bytes": 1000,
    }
    
    print("Testing media_type normalization...")
    print(f"  Sending: media_type='{payload['media_type']}'")
    
    response = client.post("/api/v1/dictation/transcribe", json=payload)
    
    print(f"  Response status: {response.status_code}")
    
    if response.status_code == 400:
        print(f"  ❌ FAILED: {response.json()}")
        print("\n  Backend still rejecting media_type with codec info!")
        print("  Backend needs to be restarted with updated code.")
        return False
    elif response.status_code in [200, 500]:
        # 200 = success, 500 = transcription failed (but validation passed!)
        print(f"  ✅ PASSED: Media type validation successful")
        print(f"     Backend accepted 'audio/webm;codecs=opus'")
        if response.status_code == 500:
            print(f"     (Transcription failed as expected with fake audio)")
        return True
    else:
        print(f"  ⚠️  Unexpected status: {response.status_code}")
        return False

def test_other_media_types():
    """Test other real-world media type formats"""
    test_cases = [
        "audio/webm",                    # Clean format
        "AUDIO/WAV",                     # Uppercase
        "  audio/mp3  ",                 # Whitespace
        "audio/ogg;codecs=vorbis",      # OGG with codec
    ]
    
    test_audio = base64.b64encode(b'\x00' * 1000).decode('utf-8')
    
    print("\nTesting additional media type formats...")
    all_passed = True
    
    for media_type in test_cases:
        payload = {
            "audio_base64": test_audio,
            "media_type": media_type,
            "duration_ms": 1000,
            "size_bytes": 1000,
        }
        
        response = client.post("/api/v1/dictation/transcribe", json=payload)
        
        if response.status_code == 400:
            print(f"  ❌ FAILED: '{media_type}' -> {response.json()}")
            all_passed = False
        else:
            print(f"  ✅ PASSED: '{media_type}' -> {response.status_code}")
    
    return all_passed

if __name__ == "__main__":
    print("=" * 60)
    print("Testing Media Type Normalization Fix")
    print("=" * 60)
    print()
    
    # Main test - the exact issue we're fixing
    test1_passed = test_media_type_with_codec_parameter()
    
    # Additional tests
    test2_passed = test_other_media_types()
    
    print()
    print("=" * 60)
    if test1_passed and test2_passed:
        print("✅ ALL TESTS PASSED - Fix is working!")
        print("=" * 60)
        sys.exit(0)
    else:
        print("❌ TESTS FAILED - Backend needs restart or fix not applied")
        print("=" * 60)
        sys.exit(1)

