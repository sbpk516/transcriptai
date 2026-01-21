#!/usr/bin/env python3
"""
Test script for Phase 1.2.2: Whisper Integration
Tests the Whisper processor with our converted audio file.
"""
import sys
import os
from pathlib import Path

def test_whisper_processor():
    """Test the Whisper processing module step by step."""
    print("🔍 Testing Phase 1.2.2: Whisper Integration...")
    
    try:
        # Import the Whisper processor
        from backend.app.whisper_processor import whisper_processor
        print("✅ Whisper processor imported successfully")
        
        # Step 1: Check model information
        print("\n📊 Step 1: Checking Model Information...")
        model_info = whisper_processor.get_model_info()
        
        if model_info.get("model_loaded"):
            print("✅ Whisper model loaded successfully!")
            print(f"   Model: {model_info.get('model_name', 'N/A')}")
            print(f"   Device: {model_info.get('device', 'N/A')}")
            print(f"   Parameters: {model_info.get('total_parameters', 'N/A'):,}")
            print(f"   Model Size: {model_info.get('model_size_mb', 'N/A')} MB")
            print(f"   CUDA Available: {model_info.get('cuda_available', 'N/A')}")
        else:
            print(f"❌ Model loading failed: {model_info.get('error', 'Unknown error')}")
            return False
        
        # Step 2: Find our converted audio file
        print("\n📁 Step 2: Finding Converted Audio File...")
        processed_dir = Path("audio_uploads/processed")
        if not processed_dir.exists():
            print("❌ No processed directory found")
            print("   Please run Phase 1.2.1 first to convert audio files")
            return False
        
        # Look for converted files
        converted_files = list(processed_dir.glob("*_converted.wav"))
        if not converted_files:
            print("❌ No converted audio files found")
            print("   Please run Phase 1.2.1 first to convert audio files")
            return False
        
        test_file = converted_files[0]
        print(f"✅ Found converted file: {test_file}")
        
        # Step 3: Test transcription
        print("\n🎤 Step 3: Testing Speech-to-Text Transcription...")
        print("   This may take a few moments...")
        
        transcription_result = whisper_processor.transcribe_audio(
            str(test_file),
            language=None,  # Auto-detect language
            task="transcribe",
            verbose=False
        )
        
        if transcription_result.get("transcription_success"):
            print("✅ Transcription successful!")
            print(f"   Language: {transcription_result.get('language', 'N/A')}")
            print(f"   Language Confidence: {transcription_result.get('language_probability', 0):.2f}")
            print(f"   Word Count: {transcription_result.get('word_count', 0)}")
            print(f"   Character Count: {transcription_result.get('character_count', 0)}")
            print(f"   Confidence Score: {transcription_result.get('confidence_score', 0):.2f}")
            print(f"   Model Used: {transcription_result.get('model_used', 'N/A')}")
            print(f"   Device Used: {transcription_result.get('device_used', 'N/A')}")
            
            # Display transcribed text
            transcribed_text = transcription_result.get("text", "")
            if transcribed_text:
                print(f"\n📝 Transcribed Text:")
                print(f"   \"{transcribed_text}\"")
            else:
                print(f"\n📝 No text transcribed (possibly silence or noise)")
        else:
            print(f"❌ Transcription failed: {transcription_result.get('error', 'Unknown error')}")
            return False
        
        # Step 4: Test transcript saving
        print("\n💾 Step 4: Testing Transcript Saving...")
        
        # Generate a test call ID
        import uuid
        test_call_id = str(uuid.uuid4())
        
        save_result = whisper_processor.save_transcript(
            transcription_result,
            test_call_id
        )
        
        if save_result.get("save_success"):
            print("✅ Transcript saved successfully!")
            print(f"   File: {save_result.get('transcript_path', 'N/A')}")
            print(f"   Size: {save_result.get('file_size_bytes', 'N/A')} bytes")
        else:
            print(f"❌ Transcript save failed: {save_result.get('error', 'Unknown error')}")
            return False
        
        # Step 5: Test with different models (optional)
        print("\n🔧 Step 5: Testing Available Models...")
        available_models = whisper_processor.get_available_models()
        print(f"   Available models: {', '.join(available_models)}")
        
        print("\n🎉 All Whisper integration tests passed!")
        print(f"📁 Transcript saved: {save_result.get('transcript_path', 'N/A')}")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("   Make sure all dependencies are installed:")
        print("   pip install openai-whisper torch")
        return False
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_whisper_processor()
    sys.exit(0 if success else 1)
