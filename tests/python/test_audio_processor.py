#!/usr/bin/env python3
"""
Test script for Phase 1.2: Audio Processing Module
Tests the audio processor with our existing uploaded file.
"""
import sys
import os
from pathlib import Path

def test_audio_processor():
    """Test the audio processing module step by step."""
    print("🔍 Testing Phase 1.2: Audio Processing Module...")
    
    try:
        # Import the audio processor
        from backend.app.audio_processor import audio_processor
        print("✅ Audio processor imported successfully")
        
        # Check if we have any uploaded files to test with
        upload_dir = Path("audio_uploads")
        if not upload_dir.exists():
            print("❌ No audio_uploads directory found")
            return False
        
        # Find uploaded files
        uploaded_files = []
        for file_path in upload_dir.rglob("*"):
            if file_path.is_file() and file_path.suffix.lower() in ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac']:
                uploaded_files.append(file_path)
        
        if not uploaded_files:
            print("❌ No audio files found in uploads directory")
            print("   Please upload a file first using the upload endpoint")
            return False
        
        # Use the first uploaded file for testing
        test_file = uploaded_files[0]
        print(f"📁 Testing with file: {test_file}")
        
        # Step 1: Test audio analysis
        print("\n🔍 Step 1: Testing Audio Analysis...")
        analysis_result = audio_processor.analyze_audio_file(str(test_file))
        
        if analysis_result.get("analysis_success"):
            print("✅ Audio analysis successful!")
            print(f"   Duration: {analysis_result.get('duration_seconds', 'N/A')} seconds")
            print(f"   Format: {analysis_result.get('format', 'N/A')}")
            print(f"   Sample Rate: {analysis_result.get('sample_rate', 'N/A')} Hz")
            print(f"   Channels: {analysis_result.get('channels', 'N/A')}")
            print(f"   File Size: {analysis_result.get('file_size_bytes', 'N/A')} bytes")
        else:
            print(f"❌ Audio analysis failed: {analysis_result.get('error', 'Unknown error')}")
            return False
        
        # Step 2: Test audio conversion (convert to WAV for Whisper)
        print("\n🔄 Step 2: Testing Audio Conversion...")
        conversion_result = audio_processor.convert_audio_format(
            str(test_file),
            output_format="wav",
            sample_rate=16000,  # Whisper recommended sample rate
            channels=1          # Mono for better speech recognition
        )
        
        if conversion_result.get("conversion_success"):
            print("✅ Audio conversion successful!")
            print(f"   Output: {conversion_result.get('output_path', 'N/A')}")
            print(f"   Output Size: {conversion_result.get('output_size_bytes', 'N/A')} bytes")
            
            # Store the converted file path for later use
            converted_file = conversion_result.get('output_path')
        else:
            print(f"❌ Audio conversion failed: {conversion_result.get('error', 'Unknown error')}")
            return False
        
        # Step 3: Test segment extraction (extract first 10 seconds)
        print("\n✂️ Step 3: Testing Audio Segment Extraction...")
        duration = min(10.0, analysis_result.get('duration_seconds', 10.0))
        segment_result = audio_processor.extract_audio_segment(
            str(test_file),
            start_time=0.0,
            duration=duration,
            output_format="wav"
        )
        
        if segment_result.get("extraction_success"):
            print("✅ Audio segment extraction successful!")
            print(f"   Segment: {segment_result.get('output_path', 'N/A')}")
            print(f"   Duration: {segment_result.get('duration', 'N/A')} seconds")
        else:
            print(f"❌ Audio segment extraction failed: {segment_result.get('error', 'Unknown error')}")
            return False
        
        print("\n🎉 All audio processing tests passed!")
        print(f"📁 Converted file ready for Whisper: {converted_file}")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("   Make sure all dependencies are installed:")
        print("   pip install ffmpeg-python")
        return False
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_audio_processor()
    sys.exit(0 if success else 1)
