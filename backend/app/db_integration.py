"""
Database integration module for TranscriptAI Phase 1.2.3.
Provides comprehensive database operations for storing transcription results and updating call statuses.
"""
import os
import json
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from .config import settings
from .debug_utils import debug_helper
from .logging_config import log_function_call, PerformanceMonitor
from .database import get_db
from .models import Call, Transcript, Analysis

# Configure logger for this module
logger = logging.getLogger('transcriptai.db_integration')

class DatabaseIntegration:
    """
    Handles database operations for TranscriptAI.
    Provides comprehensive database integration for calls, transcripts, and analyses.
    """
    
    def __init__(self):
        logger.info("Database integration initialized")
    
    @log_function_call
    def update_call_status(
        self, 
        call_id: str, 
        status: str, 
        duration: Optional[float] = None,
        additional_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update call status in the database.
        
        Args:
            call_id: Unique call identifier
            status: New status (uploaded, processing, transcribed, completed, failed)
            duration: Call duration in seconds
            additional_data: Additional data to store
            
        Returns:
            Dictionary with update operation results
        """
        logger.info(f"Updating call status: {call_id} -> {status}")
        
        with PerformanceMonitor("call_status_update") as monitor:
            try:
                db_session = next(get_db())
                
                # Find the call record
                call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
                
                if not call_record:
                    error_msg = f"Call record not found: {call_id}"
                    logger.error(error_msg)
                    return {
                        "call_id": call_id,
                        "update_success": False,
                        "error": error_msg,
                        "update_timestamp": datetime.now().isoformat()
                    }
                
                # Update call status and timestamp
                call_record.status = status
                call_record.updated_at = datetime.now()
                
                # Update duration if provided
                if duration is not None:
                    call_record.duration = duration
                
                # Commit the changes
                db_session.commit()
                
                logger.info(f"Call status updated successfully: {call_id} -> {status}")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "call_status_updated",
                    {
                        "call_id": call_id,
                        "old_status": call_record.status,
                        "new_status": status,
                        "duration": duration
                    }
                )
                
                return {
                    "call_id": call_id,
                    "update_success": True,
                    "old_status": call_record.status,
                    "new_status": status,
                    "duration": duration,
                    "update_timestamp": datetime.now().isoformat()
                }
                
            except SQLAlchemyError as e:
                logger.error(f"Database error updating call status: {e}")
                db_session.rollback()
                debug_helper.capture_exception(
                    "call_status_update_db_error",
                    e,
                    {"call_id": call_id, "status": status}
                )
                return {
                    "call_id": call_id,
                    "update_success": False,
                    "error": f"Database error: {str(e)}",
                    "update_timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                logger.error(f"Error updating call status: {e}")
                debug_helper.capture_exception(
                    "call_status_update_error",
                    e,
                    {"call_id": call_id, "status": status}
                )
                return {
                    "call_id": call_id,
                    "update_success": False,
                    "error": str(e),
                    "update_timestamp": datetime.now().isoformat()
                }
            finally:
                db_session.close()
    
    @log_function_call
    def store_transcript(
        self, 
        call_id: str, 
        transcription_data: Dict[str, Any],
        transcript_file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Store transcription results in the database.
        
        Args:
            call_id: Unique call identifier
            transcription_data: Transcription results from Whisper
            transcript_file_path: Path to transcript file (optional)
            
        Returns:
            Dictionary with store operation results
        """
        logger.info(f"Storing transcript for call: {call_id}")
        
        with PerformanceMonitor("transcript_storage") as monitor:
            try:
                db_session = next(get_db())
                
                # Check if call exists
                call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
                if not call_record:
                    error_msg = f"Call record not found: {call_id}"
                    logger.error(error_msg)
                    return {
                        "call_id": call_id,
                        "store_success": False,
                        "error": error_msg,
                        "store_timestamp": datetime.now().isoformat()
                    }
                
                # Extract text from transcription_data
                # Handle different possible structures
                text = transcription_data.get("text", "")
                if not text and "transcription_text" in transcription_data:
                    text = transcription_data.get("transcription_text", "")
                if not text and "transcript" in transcription_data:
                    # If transcript is a dict, extract text from it
                    transcript_obj = transcription_data.get("transcript", {})
                    if isinstance(transcript_obj, dict):
                        text = transcript_obj.get("text", "")
                    elif isinstance(transcript_obj, str):
                        text = transcript_obj
                
                # Log what we're storing
                logger.info(f"Storing transcript text length: {len(text)} characters")
                if len(text) > 0:
                    logger.info(f"First 100 chars: {text[:100]}")
                else:
                    logger.warning(f"WARNING: Empty transcript text for call_id {call_id}")
                    logger.warning(f"Transcription data structure: {list(transcription_data.keys())}")
                    logger.warning(f"Full transcription_data: {transcription_data}")
                
                # Create transcript record (using available fields)
                transcript_record = Transcript(
                    call_id=call_id,
                    text=text or "",  # Ensure not None
                    language=transcription_data.get("language", "en"),
                    confidence=int(transcription_data.get("confidence_score", 0.0) * 100)  # Convert to 0-100 scale
                )
                
                # Add and commit
                db_session.add(transcript_record)
                db_session.commit()
                
                logger.info(f"Transcript stored successfully for call: {call_id}")
                logger.info(f"Text length: {len(transcript_record.text.split())} words, {len(transcript_record.text)} characters")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "transcript_stored",
                    {
                        "call_id": call_id,
                        "transcript_id": transcript_record.id,
                        "word_count": len(transcript_record.text.split()),
                        "confidence": transcript_record.confidence,
                        "language": transcript_record.language
                    }
                )
                
                return {
                    "call_id": call_id,
                    "store_success": True,
                    "transcript_id": transcript_record.id,
                    "confidence": transcript_record.confidence,
                    "language": transcript_record.language,
                    "store_timestamp": datetime.now().isoformat()
                }
                
            except SQLAlchemyError as e:
                logger.error(f"Database error storing transcript: {e}")
                db_session.rollback()
                debug_helper.capture_exception(
                    "transcript_storage_db_error",
                    e,
                    {"call_id": call_id, "transcription_data_keys": list(transcription_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": f"Database error: {str(e)}",
                    "store_timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                logger.error(f"Error storing transcript: {e}")
                debug_helper.capture_exception(
                    "transcript_storage_error",
                    e,
                    {"call_id": call_id, "transcription_data_keys": list(transcription_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": str(e),
                    "store_timestamp": datetime.now().isoformat()
                }
            finally:
                db_session.close()
    
    @log_function_call
    def store_nlp_analysis(
        self, 
        call_id: str, 
        nlp_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Store NLP analysis results in the database.
        
        Args:
            call_id: Unique call identifier
            nlp_data: NLP analysis results
            
        Returns:
            Dictionary with store operation results
        """
        logger.info(f"Storing NLP analysis for call: {call_id}")
        
        with PerformanceMonitor("nlp_analysis_storage") as monitor:
            try:
                db_session = next(get_db())
                
                # Check if call exists
                call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
                if not call_record:
                    error_msg = f"Call record not found: {call_id}"
                    logger.error(error_msg)
                    return {
                        "call_id": call_id,
                        "store_success": False,
                        "error": error_msg,
                        "store_timestamp": datetime.now().isoformat()
                    }
                
                # Extract data from NLP analysis
                intent_data = nlp_data.get("intent", {})
                sentiment_data = nlp_data.get("sentiment", {})
                risk_data = nlp_data.get("risk", {})
                keywords = nlp_data.get("keywords", [])
                
                # Create analysis record
                analysis_record = Analysis(
                    call_id=call_id,
                    intent=intent_data.get("intent", "unknown"),
                    intent_confidence=int(intent_data.get("confidence", 0.0) * 100),
                    sentiment=sentiment_data.get("sentiment", "neutral"),
                    sentiment_score=sentiment_data.get("sentiment_score", 0),
                    escalation_risk=risk_data.get("escalation_risk", "low"),
                    risk_score=risk_data.get("risk_score", 0),
                    keywords=json.dumps(keywords),
                    topics=json.dumps([]),  # Will be implemented in Week 4
                    urgency_level=risk_data.get("urgency_level", "low"),
                    compliance_risk=risk_data.get("compliance_risk", "none")
                )
                
                # Add and commit
                db_session.add(analysis_record)
                db_session.commit()
                
                logger.info(f"NLP analysis stored successfully for call: {call_id}")
                logger.info(f"Intent: {analysis_record.intent} (confidence: {analysis_record.intent_confidence}%)")
                logger.info(f"Sentiment: {analysis_record.sentiment} (score: {analysis_record.sentiment_score})")
                logger.info(f"Risk: {analysis_record.escalation_risk} (score: {analysis_record.risk_score})")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "nlp_analysis_stored",
                    {
                        "call_id": call_id,
                        "analysis_id": analysis_record.id,
                        "intent": analysis_record.intent,
                        "intent_confidence": analysis_record.intent_confidence,
                        "sentiment": analysis_record.sentiment,
                        "sentiment_score": analysis_record.sentiment_score,
                        "escalation_risk": analysis_record.escalation_risk,
                        "risk_score": analysis_record.risk_score,
                        "keywords_count": len(keywords)
                    }
                )
                
                return {
                    "call_id": call_id,
                    "store_success": True,
                    "analysis_id": analysis_record.id,
                    "intent": analysis_record.intent,
                    "sentiment": analysis_record.sentiment,
                    "risk_level": analysis_record.escalation_risk,
                    "store_timestamp": datetime.now().isoformat()
                }
                
            except SQLAlchemyError as e:
                logger.error(f"Database error storing NLP analysis: {e}")
                db_session.rollback()
                debug_helper.capture_exception(
                    "nlp_analysis_storage_db_error",
                    e,
                    {"call_id": call_id, "nlp_data_keys": list(nlp_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": f"Database error: {str(e)}",
                    "store_timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                logger.error(f"Error storing NLP analysis: {e}")
                debug_helper.capture_exception(
                    "nlp_analysis_storage_error",
                    e,
                    {"call_id": call_id, "nlp_data_keys": list(nlp_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": str(e),
                    "store_timestamp": datetime.now().isoformat()
                }
            finally:
                db_session.close()
    
    @log_function_call
    def store_audio_analysis(
        self, 
        call_id: str, 
        analysis_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Store audio analysis results in the database.
        
        Args:
            call_id: Unique call identifier
            analysis_data: Audio analysis results from FFmpeg
            
        Returns:
            Dictionary with store operation results
        """
        logger.info(f"Storing audio analysis for call: {call_id}")
        
        with PerformanceMonitor("audio_analysis_storage") as monitor:
            try:
                db_session = next(get_db())
                
                # Check if call exists
                call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
                if not call_record:
                    error_msg = f"Call record not found: {call_id}"
                    logger.error(error_msg)
                    return {
                        "call_id": call_id,
                        "store_success": False,
                        "error": error_msg,
                        "store_timestamp": datetime.now().isoformat()
                    }
                
                # If audio analysis provided duration or file size, persist to call record
                try:
                    duration_seconds = int(analysis_data.get("duration_seconds", 0) or 0)
                except Exception:
                    duration_seconds = 0

                try:
                    file_size_bytes = int(analysis_data.get("file_size_bytes", 0) or 0)
                except Exception:
                    file_size_bytes = 0

                updated_fields = {}
                if duration_seconds and (call_record.duration is None or call_record.duration == 0):
                    call_record.duration = duration_seconds
                    updated_fields["duration"] = duration_seconds

                if file_size_bytes and (call_record.file_size_bytes is None or call_record.file_size_bytes == 0):
                    call_record.file_size_bytes = file_size_bytes
                    updated_fields["file_size_bytes"] = file_size_bytes

                if updated_fields:
                    # Touch updated_at by committing the change
                    db_session.add(call_record)
                    db_session.commit()
                    logger.info(
                        f"Updated call {call_id} with audio analysis fields: {updated_fields}"
                    )

                # Create analysis record (using available fields)
                analysis_record = Analysis(
                    call_id=call_id,
                    intent="audio_analysis",  # Use intent field for analysis type
                    sentiment="neutral",  # Default sentiment for audio analysis
                    sentiment_score=0,  # Neutral sentiment score
                    escalation_risk="low",  # Default risk for audio analysis
                    risk_score=0  # Default risk score
                )
                
                # Add and commit
                db_session.add(analysis_record)
                db_session.commit()
                
                logger.info(f"Audio analysis stored successfully for call: {call_id}")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "audio_analysis_stored",
                    {
                        "call_id": call_id,
                        "analysis_id": analysis_record.id,
                        "duration": analysis_data.get("duration_seconds", 0),
                        "format": analysis_data.get("format", "unknown"),
                        "file_size_bytes": analysis_data.get("file_size_bytes", 0),
                        "call_updates": updated_fields
                    }
                )
                
                return {
                    "call_id": call_id,
                    "store_success": True,
                    "analysis_id": analysis_record.id,
                    "intent": analysis_record.intent,
                    "sentiment": analysis_record.sentiment,
                    "store_timestamp": datetime.now().isoformat()
                }
                
            except SQLAlchemyError as e:
                logger.error(f"Database error storing audio analysis: {e}")
                db_session.rollback()
                debug_helper.capture_exception(
                    "audio_analysis_storage_db_error",
                    e,
                    {"call_id": call_id, "analysis_data_keys": list(analysis_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": f"Database error: {str(e)}",
                    "store_timestamp": datetime.now().isoformat()
                }
            except Exception as e:
                logger.error(f"Error storing audio analysis: {e}")
                debug_helper.capture_exception(
                    "audio_analysis_storage_error",
                    e,
                    {"call_id": call_id, "analysis_data_keys": list(analysis_data.keys())}
                )
                return {
                    "call_id": call_id,
                    "store_success": False,
                    "error": str(e),
                    "store_timestamp": datetime.now().isoformat()
                }
            finally:
                db_session.close()
    
    @log_function_call
    def get_call_with_transcript(self, call_id: str) -> Dict[str, Any]:
        """
        Get call information with associated transcript and analysis.
        
        Args:
            call_id: Unique call identifier
            
        Returns:
            Dictionary with call, transcript, and analysis information
        """
        logger.info(f"Getting call with transcript: {call_id}")
        
        try:
            db_session = next(get_db())
            
            # Get call record
            call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
            if not call_record:
                return {
                    "call_id": call_id,
                    "found": False,
                    "error": "Call not found"
                }
            
            # Get transcript record
            transcript_record = db_session.query(Transcript).filter(Transcript.call_id == call_id).first()
            
            # Get analysis records
            analysis_records = db_session.query(Analysis).filter(Analysis.call_id == call_id).all()
            
            # Prepare response
            result = {
                "call_id": call_id,
                "found": True,
                "call": {
                    "id": call_record.id,
                    "call_id": call_record.call_id,
                    "duration": call_record.duration,
                    "file_path": call_record.file_path,
                    "status": call_record.status,
                    "created_at": call_record.created_at.isoformat() if call_record.created_at else None,
                    "updated_at": call_record.updated_at.isoformat() if call_record.updated_at else None
                },
                "transcript": None,
                "analyses": []
            }
            
            # Add transcript if exists
            if transcript_record:
                result["transcript"] = {
                    "id": transcript_record.id,
                    "text": transcript_record.text,
                    "language": transcript_record.language,
                    "confidence": transcript_record.confidence,
                    "created_at": transcript_record.created_at.isoformat() if transcript_record.created_at else None
                }
            
            # Add analyses if exist
            for analysis in analysis_records:
                result["analyses"].append({
                    "id": analysis.id,
                    "intent": analysis.intent,
                    "sentiment": analysis.sentiment,
                    "sentiment_score": analysis.sentiment_score,
                    "escalation_risk": analysis.escalation_risk,
                    "risk_score": analysis.risk_score,
                    "created_at": analysis.created_at.isoformat() if analysis.created_at else None
                })
            
            logger.info(f"Call data retrieved successfully: {call_id}")
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting call with transcript: {e}")
            debug_helper.capture_exception(
                "get_call_with_transcript_error",
                e,
                {"call_id": call_id}
            )
            return {
                "call_id": call_id,
                "found": False,
                "error": str(e)
            }
        finally:
            db_session.close()
    
    @log_function_call
    def get_processing_status(self, call_id: str) -> Dict[str, Any]:
        """
        Get comprehensive processing status for a call.
        
        Args:
            call_id: Unique call identifier
            
        Returns:
            Dictionary with processing status information
        """
        logger.info(f"Getting processing status for call: {call_id}")
        
        try:
            db_session = next(get_db())
            
            # Get call record
            call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
            if not call_record:
                return {
                    "call_id": call_id,
                    "found": False,
                    "error": "Call not found"
                }
            
            # Get transcript record
            transcript_record = db_session.query(Transcript).filter(Transcript.call_id == call_id).first()
            
            # Get analysis records
            analysis_records = db_session.query(Analysis).filter(Analysis.call_id == call_id).all()
            
            # Determine processing stage
            processing_stage = "unknown"
            if call_record.status == "uploaded":
                processing_stage = "uploaded"
            elif call_record.status == "processing":
                processing_stage = "processing"
            elif call_record.status == "transcribed":
                processing_stage = "transcribed"
            elif call_record.status == "completed":
                processing_stage = "completed"
            elif call_record.status == "failed":
                processing_stage = "failed"
            
            # Prepare status response
            status_info = {
                "call_id": call_id,
                "found": True,
                "status": call_record.status,
                "processing_stage": processing_stage,
                "duration": call_record.duration,
                "file_path": call_record.file_path,
                "created_at": call_record.created_at.isoformat() if call_record.created_at else None,
                "updated_at": call_record.updated_at.isoformat() if call_record.updated_at else None,
                "has_transcript": transcript_record is not None,
                "has_analysis": len(analysis_records) > 0,
                "analysis_count": len(analysis_records)
            }
            
            # Add transcript summary if exists
            if transcript_record:
                status_info["transcript_summary"] = {
                    "language": transcript_record.language,
                    "confidence": transcript_record.confidence
                }
            
            # Add analysis summary if exists
            if analysis_records:
                status_info["analysis_summary"] = {
                    "intents": [analysis.intent for analysis in analysis_records],
                    "count": len(analysis_records)
                }
            
            logger.info(f"Processing status retrieved successfully: {call_id} -> {processing_stage}")
            
            return status_info
            
        except Exception as e:
            logger.error(f"Error getting processing status: {e}")
            debug_helper.capture_exception(
                "get_processing_status_error",
                e,
                {"call_id": call_id}
            )
            return {
                "call_id": call_id,
                "found": False,
                "error": str(e)
            }
        finally:
            db_session.close()

# Global database integration instance
db_integration = DatabaseIntegration()
