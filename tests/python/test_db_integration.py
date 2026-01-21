#!/usr/bin/env python3
"""
Test script for Phase 1.2.3: Database Integration
Tests the database integration with our existing call data and transcription results.
"""
import sys
import os
from pathlib import Path

def test_db_integration():
    """Test the database integration module step by step."""
    print("🔍 Testing Phase 1.2.3: Database Integration...")
    
    try:
        # Import the database integration
        from backend.app.db_integration import db_integration
        print("✅ Database integration imported successfully")
        
        # Step 1: Find an existing call ID from our database
        print("\n📋 Step 1: Finding Existing Call...")
        from backend.app.database import get_db
        from backend.app.models import Call
        
        db_session = next(get_db())
        existing_calls = db_session.query(Call).all()
        db_session.close()
        
        if not existing_calls:
            print("❌ No existing calls found in database")
            print("   Please upload a file first using the upload endpoint")
            return False
        
        test_call = existing_calls[0]
        test_call_id = test_call.call_id
        print(f"✅ Found existing call: {test_call_id}")
        print(f"   Status: {test_call.status}")
        print(f"   File: {test_call.file_path}")
        
        # Step 2: Test call status update
        print("\n🔄 Step 2: Testing Call Status Update...")
        status_update_result = db_integration.update_call_status(
            test_call_id,
            "processing",
            duration=3.0
        )
        
        if status_update_result.get("update_success"):
            print("✅ Call status updated successfully!")
            print(f"   Old Status: {status_update_result.get('old_status', 'N/A')}")
            print(f"   New Status: {status_update_result.get('new_status', 'N/A')}")
            print(f"   Duration: {status_update_result.get('duration', 'N/A')} seconds")
        else:
            print(f"❌ Call status update failed: {status_update_result.get('error', 'Unknown error')}")
            return False
        
        # Step 3: Test audio analysis storage
        print("\n📊 Step 3: Testing Audio Analysis Storage...")
        test_analysis_data = {
            "duration_seconds": 3.0,
            "format": "wav",
            "sample_rate": 16000,
            "channels": 1,
            "file_size_bytes": 96078,
            "analysis_success": True
        }
        
        analysis_storage_result = db_integration.store_audio_analysis(
            test_call_id,
            test_analysis_data
        )
        
        if analysis_storage_result.get("store_success"):
            print("✅ Audio analysis stored successfully!")
            print(f"   Analysis ID: {analysis_storage_result.get('analysis_id', 'N/A')}")
            print(f"   Duration: {analysis_storage_result.get('duration_seconds', 'N/A')} seconds")
            print(f"   Format: {analysis_storage_result.get('format', 'N/A')}")
        else:
            print(f"❌ Audio analysis storage failed: {analysis_storage_result.get('error', 'Unknown error')}")
            return False
        
        # Step 4: Test transcript storage
        print("\n📝 Step 4: Testing Transcript Storage...")
        test_transcription_data = {
            "text": "This is a test transcription from our Whisper integration.",
            "language": "en",
            "confidence_score": 0.85,
            "word_count": 10,
            "character_count": 58,
            "model_used": "base",
            "device_used": "cpu",
            "segments": []
        }
        
        transcript_storage_result = db_integration.store_transcript(
            test_call_id,
            test_transcription_data,
            transcript_file_path="audio_uploads/transcripts/2025/08/27/test_transcript.json"
        )
        
        if transcript_storage_result.get("store_success"):
            print("✅ Transcript stored successfully!")
            print(f"   Transcript ID: {transcript_storage_result.get('transcript_id', 'N/A')}")
            print(f"   Word Count: {transcript_storage_result.get('word_count', 'N/A')}")
            print(f"   Language: {transcript_storage_result.get('language', 'N/A')}")
            print(f"   Confidence: {transcript_storage_result.get('confidence_score', 'N/A')}")
        else:
            print(f"❌ Transcript storage failed: {transcript_storage_result.get('error', 'Unknown error')}")
            return False
        
        # Step 5: Test processing status retrieval
        print("\n📈 Step 5: Testing Processing Status Retrieval...")
        status_result = db_integration.get_processing_status(test_call_id)
        
        if status_result.get("found"):
            print("✅ Processing status retrieved successfully!")
            print(f"   Status: {status_result.get('status', 'N/A')}")
            print(f"   Processing Stage: {status_result.get('processing_stage', 'N/A')}")
            print(f"   Has Transcript: {status_result.get('has_transcript', 'N/A')}")
            print(f"   Has Analysis: {status_result.get('has_analysis', 'N/A')}")
            print(f"   Analysis Count: {status_result.get('analysis_count', 'N/A')}")
            
            if status_result.get("transcript_summary"):
                summary = status_result["transcript_summary"]
                print(f"   Transcript Summary:")
                print(f"     Word Count: {summary.get('word_count', 'N/A')}")
                print(f"     Language: {summary.get('language', 'N/A')}")
                print(f"     Confidence: {summary.get('confidence_score', 'N/A')}")
        else:
            print(f"❌ Processing status retrieval failed: {status_result.get('error', 'Unknown error')}")
            return False
        
        # Step 6: Test complete call data retrieval
        print("\n📋 Step 6: Testing Complete Call Data Retrieval...")
        call_data_result = db_integration.get_call_with_transcript(test_call_id)
        
        if call_data_result.get("found"):
            print("✅ Complete call data retrieved successfully!")
            call_info = call_data_result.get("call", {})
            print(f"   Call ID: {call_info.get('call_id', 'N/A')}")
            print(f"   Status: {call_info.get('status', 'N/A')}")
            print(f"   Duration: {call_info.get('duration', 'N/A')}")
            
            transcript_info = call_data_result.get("transcript")
            if transcript_info:
                print(f"   Transcript: {transcript_info.get('text', 'N/A')[:50]}...")
            
            analyses = call_data_result.get("analyses", [])
            print(f"   Analyses: {len(analyses)} found")
        else:
            print(f"❌ Complete call data retrieval failed: {call_data_result.get('error', 'Unknown error')}")
            return False
        
        # Step 7: Update status to completed
        print("\n✅ Step 7: Updating Status to Completed...")
        final_status_result = db_integration.update_call_status(
            test_call_id,
            "completed"
        )
        
        if final_status_result.get("update_success"):
            print("✅ Final status update successful!")
        else:
            print(f"❌ Final status update failed: {final_status_result.get('error', 'Unknown error')}")
            return False
        
        print("\n🎉 All database integration tests passed!")
        print(f"📊 Call ID: {test_call_id}")
        print(f"📈 Final Status: completed")
        print(f"📝 Transcript: stored")
        print(f"📊 Analysis: stored")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("   Make sure all dependencies are installed:")
        print("   pip install sqlalchemy psycopg2-binary")
        return False
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_db_integration()
    sys.exit(0 if success else 1)
