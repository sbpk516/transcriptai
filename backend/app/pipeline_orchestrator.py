"""
Pipeline Orchestrator for SignalHub Phase 1.3.
Central controller for the complete audio processing pipeline.
Manages the flow: Upload → Audio Processing → Transcription → Database Storage
"""
import os
import uuid
import json
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from fastapi import UploadFile

from .config import settings, is_live_transcription_enabled, is_live_batch_only
from .upload import AudioUploadHandler
from .audio_processor import AudioProcessor
from .whisper_backend_selector import get_global_whisper_processor
from .live_events import event_bus
from .db_integration import DatabaseIntegration
from .nlp_processor import nlp_processor
from .debug_utils import debug_helper
from .logging_config import log_function_call, PerformanceMonitor
from .models import Call
from .pipeline_monitor import pipeline_monitor
from .pipeline_logger import pipeline_logger

# Configure logger for this module
logger = logging.getLogger('signalhub.pipeline_orchestrator')


class PipelineStatusTracker:
    """
    Tracks the status of each step in the pipeline.
    Provides real-time debugging information.
    """
    
    def __init__(self):
        self.step_status = {}
        self.step_timings = {}
        self.step_errors = {}
        self.step_results = {}
        logger.info("Pipeline status tracker initialized")
    
    def start_step(self, call_id: str, step_name: str):
        """Mark step as started with timestamp"""
        if call_id not in self.step_status:
            self.step_status[call_id] = {}
            self.step_timings[call_id] = {}
            self.step_errors[call_id] = {}
            self.step_results[call_id] = {}
        
        self.step_status[call_id][step_name] = "running"
        self.step_timings[call_id][step_name] = {
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "duration_seconds": None
        }
        
        logger.info(f"Pipeline step started: {call_id} -> {step_name}")
        debug_helper.log_debug_info(
            "pipeline_step_started",
            {"call_id": call_id, "step_name": step_name}
        )
    
    def complete_step(self, call_id: str, step_name: str, result: Dict):
        """Mark step as completed with results and timing"""
        if call_id in self.step_status and step_name in self.step_status[call_id]:
            self.step_status[call_id][step_name] = "completed"
            
            # Calculate timing
            start_time = datetime.fromisoformat(self.step_timings[call_id][step_name]["start_time"])
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            
            self.step_timings[call_id][step_name].update({
                "end_time": end_time.isoformat(),
                "duration_seconds": duration
            })
            
            # Store results
            self.step_results[call_id][step_name] = result
            
            logger.info(f"Pipeline step completed: {call_id} -> {step_name} (took {duration:.2f}s)")
            debug_helper.log_debug_info(
                "pipeline_step_completed",
                {
                    "call_id": call_id, 
                    "step_name": step_name, 
                    "duration_seconds": duration,
                    "result_summary": {k: str(v)[:100] + "..." if len(str(v)) > 100 else v 
                                     for k, v in result.items()}
                }
            )
    
    def fail_step(self, call_id: str, step_name: str, error: Exception):
        """Mark step as failed with error details"""
        if call_id in self.step_status and step_name in self.step_status[call_id]:
            self.step_status[call_id][step_name] = "failed"
            
            # Calculate timing
            start_time = datetime.fromisoformat(self.step_timings[call_id][step_name]["start_time"])
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            
            self.step_timings[call_id][step_name].update({
                "end_time": end_time.isoformat(),
                "duration_seconds": duration
            })
            
            # Store error
            self.step_errors[call_id][step_name] = {
                "error_type": type(error).__name__,
                "error_message": str(error),
                "timestamp": end_time.isoformat()
            }
            
            logger.error(f"Pipeline step failed: {call_id} -> {step_name} (took {duration:.2f}s): {error}")
            debug_helper.log_debug_info(
                "pipeline_step_failed",
                {
                    "call_id": call_id, 
                    "step_name": step_name, 
                    "duration_seconds": duration,
                    "error_type": type(error).__name__,
                    "error_message": str(error)
                }
            )
    
    def get_pipeline_status(self, call_id: str) -> Dict:
        """Get complete pipeline status for debugging"""
        if call_id not in self.step_status:
            return {"error": f"Call ID {call_id} not found in pipeline tracker"}
        
        return {
            "call_id": call_id,
            "step_status": self.step_status[call_id],
            "step_timings": self.step_timings[call_id],
            "step_errors": self.step_errors[call_id],
            "step_results": {k: "Result available" for k in self.step_results[call_id].keys()} if isinstance(self.step_results[call_id], dict) else {"error": "Invalid result format"},
            "overall_status": self._get_overall_status(call_id),
            "total_duration": self._calculate_total_duration(call_id)
        }
    
    def _get_overall_status(self, call_id: str) -> str:
        """Determine overall pipeline status"""
        if call_id not in self.step_status:
            return "not_found"
        
        statuses = self.step_status[call_id].values()
        
        if "failed" in statuses:
            return "failed"
        elif "running" in statuses:
            return "running"
        elif all(status == "completed" for status in statuses):
            return "completed"
        else:
            return "partial"
    
    def _calculate_total_duration(self, call_id: str) -> Optional[float]:
        """Calculate total pipeline duration"""
        if call_id not in self.step_timings:
            return None
        
        total_duration = 0
        for step_timing in self.step_timings[call_id].values():
            if step_timing.get("duration_seconds"):
                total_duration += step_timing["duration_seconds"]
        
        return total_duration


class PipelineDebugLogger:
    """
    Comprehensive logging for pipeline debugging.
    """
    
    def __init__(self):
        # Use the centralized debug helper's directory which respects SIGNALHUB_DATA_DIR
        from .debug_utils import debug_helper as _dh
        self.debug_dir = _dh.debug_dir
        logger.info(f"Pipeline debug logger initialized with directory: {self.debug_dir}")
    
    def log_pipeline_start(self, call_id: str, file_info: Dict):
        """Log pipeline start with file information"""
        debug_info = {
            "call_id": call_id,
            "pipeline_start_time": datetime.now().isoformat(),
            "file_info": file_info,
            "pipeline_version": "1.3"
        }
        
        debug_helper.log_debug_info("pipeline_started", debug_info)
        logger.info(f"Pipeline started: {call_id} with file: {file_info.get('filename', 'unknown')}")
    
    def log_pipeline_complete(self, call_id: str, final_result: Dict):
        """Log pipeline completion with summary"""
        debug_info = {
            "call_id": call_id,
            "pipeline_end_time": datetime.now().isoformat(),
            "final_result_summary": {
                k: str(v)[:200] + "..." if len(str(v)) > 200 else v 
                for k, v in final_result.items()
            }
        }
        
        debug_helper.log_debug_info("pipeline_completed", debug_info)
        logger.info(f"Pipeline completed: {call_id}")
    
    def log_pipeline_error(self, call_id: str, error: Exception, step_name: str = None):
        """Log pipeline error with detailed information"""
        debug_info = {
            "call_id": call_id,
            "error_time": datetime.now().isoformat(),
            "error_type": type(error).__name__,
            "error_message": str(error),
            "step_name": step_name
        }
        
        debug_helper.log_debug_info("pipeline_error", debug_info)
        logger.error(f"Pipeline error: {call_id} at step {step_name}: {error}")


class AudioProcessingPipeline:
    """
    Central orchestrator for the complete audio processing pipeline.
    Manages the flow: Upload → Audio Processing → Transcription → Database Storage
    """
    
    def __init__(self):
        # Initialize all components
        self.upload_handler = AudioUploadHandler()
        self.audio_processor = AudioProcessor()
        self.whisper_processor = get_global_whisper_processor()  # Use backend selector for MLX/PyTorch
        self.db_integration = DatabaseIntegration()
        
        # Initialize tracking and debugging
        self.status_tracker = PipelineStatusTracker()
        self.debug_logger = PipelineDebugLogger()
        
        # Pipeline data store for passing information between steps
        self.pipeline_data = {}
        
        logger.info("Audio processing pipeline initialized successfully")
    
    @log_function_call
    async def process_audio_file(self, file: UploadFile) -> Dict[str, Any]:
        """
        Complete pipeline: Upload → Process → Transcribe → Store
        
        Args:
            file: Uploaded audio file
            
        Returns:
            Complete pipeline result with all processing information
        """
        call_id = str(uuid.uuid4())
        
        # Log pipeline start
        file_info = {
            "filename": file.filename,
            "content_type": file.content_type,
            "size": getattr(file, 'size', 'unknown')
        }
        self.debug_logger.log_pipeline_start(call_id, file_info)
        
        # Start monitoring
        pipeline_monitor.start_pipeline_monitoring(call_id, file_info)
        
        try:
            logger.info(f"Starting complete pipeline processing for call: {call_id}")
            
            # Step 1: Upload and Validate
            upload_result = await self._step_upload(file, call_id)
            
            # Step 2: Audio Processing
            processing_result = await self._step_audio_processing(call_id)
            
            # Step 3: Transcription
            transcription_result = await self._step_transcription(call_id)
            
            # Step 4: NLP Analysis
            nlp_result = await self._step_nlp_analysis(call_id)
            
            # Step 5: Database Storage
            storage_result = await self._step_database_storage(call_id)
            
            # Compile final result
            final_result = self._compile_pipeline_result(
                call_id, upload_result, processing_result, 
                transcription_result, nlp_result, storage_result
            )
            
            # Log pipeline completion
            self.debug_logger.log_pipeline_complete(call_id, final_result)
            
            # Complete monitoring
            pipeline_monitor.complete_pipeline(call_id, final_result)
            
            logger.info(f"Pipeline completed successfully for call: {call_id}")
            return final_result
            
        except Exception as e:
            # Log pipeline error
            self.debug_logger.log_pipeline_error(call_id, e)
            
            # Fail monitoring
            pipeline_monitor.fail_pipeline(call_id, e)
            
            await self._handle_pipeline_error(call_id, e)
            raise
    
    async def _step_upload(self, file: UploadFile, call_id: str) -> Dict[str, Any]:
        """
        Step 1: Upload and validate audio file
        """
        self.status_tracker.start_step(call_id, "upload")
        
        try:
            logger.info(f"Step 1: Uploading and validating file for call: {call_id}")
            
            # Validate file
            validation_result = await self.upload_handler.validate_upload(file)
            if not validation_result["is_valid"]:
                raise ValueError(f"File validation failed: {validation_result['errors']}")
            
            # Save file
            file_path = await self.upload_handler.save_audio_file(file, call_id)
            
            # Create call record in database
            db_session = next(self._get_db())
            call_record = await self.upload_handler.create_call_record(
                db_session, file_path, file.filename, call_id, validation_result["file_info"]["size"]
            )
            
            # Update database status
            self.db_integration.update_call_status(call_id, "uploaded")
            
            result = {
                "file_path": file_path,
                "file_info": validation_result["file_info"],
                "validation_passed": True,
                "call_record_created": True
            }
            
            # Store data for next steps
            self.pipeline_data[call_id] = {
                "file_path": file_path,
                "file_info": validation_result["file_info"]
            }
            
            self.status_tracker.complete_step(call_id, "upload", result)
            
            # Update monitoring
            pipeline_monitor.update_pipeline_step(call_id, "upload", "completed", 
                                                self.status_tracker.step_timings[call_id]["upload"]["duration_seconds"])
            return result
            
        except Exception as e:
            self.status_tracker.fail_step(call_id, "upload", e)
            self.db_integration.update_call_status(call_id, "failed", additional_data={"error": str(e)})
            raise
    
    async def _step_audio_processing(self, call_id: str) -> Dict[str, Any]:
        """
        Step 2: Process audio file (analysis, conversion, segmentation)
        """
        self.status_tracker.start_step(call_id, "audio_processing")
        
        try:
            logger.info(f"Step 2: Processing audio for call: {call_id}")
            
            # Get file path from pipeline data (already stored in upload step)
            if call_id not in self.pipeline_data:
                raise ValueError(f"Pipeline data not found for call_id: {call_id}")
            file_path = self.pipeline_data[call_id]["file_path"]
            
            # Update status
            self.db_integration.update_call_status(call_id, "processing")
            
            # Analyze audio with retry logic
            analysis_result = await self._retry_operation(
                lambda: self.audio_processor.analyze_audio_file(file_path),
                operation_name="audio_analysis",
                max_retries=3
            )
            
            # Convert audio if needed with retry logic
            conversion_result = {"status": "skipped", "message": "Audio conversion not implemented yet"}
            
            # Extract segments (optional) with retry logic
            segments_result = {"status": "skipped", "message": "Audio segmentation not implemented yet"}
            
            result = {
                "analysis": analysis_result,
                "conversion": conversion_result,
                "segments": segments_result,
                "processed_file_path": conversion_result.get("output_path", file_path)
            }
            
            # Update pipeline data with processing results
            if call_id in self.pipeline_data:
                self.pipeline_data[call_id].update({
                    "processed_file_path": conversion_result.get("output_path", file_path),
                    "analysis_result": analysis_result
                })
            
            self.status_tracker.complete_step(call_id, "audio_processing", result)
            
            # Update monitoring
            pipeline_monitor.update_pipeline_step(call_id, "audio_processing", "completed", 
                                                self.status_tracker.step_timings[call_id]["audio_processing"]["duration_seconds"])
            return result
            
        except Exception as e:
            self.status_tracker.fail_step(call_id, "audio_processing", e)
            self.db_integration.update_call_status(call_id, "failed", additional_data={"error": str(e)})
            raise
    
    async def _step_transcription(self, call_id: str) -> Dict[str, Any]:
        """
        Step 3: Transcribe audio using Whisper
        """
        self.status_tracker.start_step(call_id, "transcription")
        
        try:
            logger.info(f"Step 3: Transcribing audio for call: {call_id}")
            
            # Get processed audio file path from pipeline data
            if call_id not in self.pipeline_data:
                raise ValueError(f"Pipeline data not found for call_id: {call_id}")
            
            # Use processed file path if available, otherwise use original
            if "processed_file_path" in self.pipeline_data[call_id]:
                audio_path = self.pipeline_data[call_id]["processed_file_path"]
            else:
                audio_path = self.pipeline_data[call_id]["file_path"]

            # Update status
            self.db_integration.update_call_status(call_id, "transcribing")

            try:
                load_result = self.whisper_processor.ensure_loaded()
                if load_result:
                    logger.info(f"Whisper model loaded for call {call_id}")
            except TimeoutError as exc:
                logger.error(f"Whisper model load timed out for call {call_id}: {exc}")
                raise RuntimeError("Whisper model load timed out") from exc
            except Exception as exc:
                logger.error(f"Failed to prepare Whisper model for call {call_id}: {exc}")
                raise

            live_enabled = is_live_transcription_enabled()
            batch_only = is_live_batch_only()
            logger.info(f"Live transcription enabled for call {call_id}: {live_enabled}; batch_only={batch_only}")

            if live_enabled and not batch_only:
                # Chunked progressive transcription with SSE emits
                import os
                chunk_sec = int(os.getenv("SIGNALHUB_LIVE_CHUNK_SEC", "3600") or 3600)  # 60 minutes default
                stride_sec = int(os.getenv("SIGNALHUB_LIVE_STRIDE_SEC", "60") or 60)  # 1 minute overlap (1.7% overlap)
                final_parts: List[str] = []

                def _do_chunked():
                    generator = self.whisper_processor.transcribe_in_chunks(audio_path, chunk_sec=chunk_sec, stride_sec=stride_sec)
                    final_summary = None
                    
                    try:
                        while True:
                            part = next(generator)
                            # Emit partial only if live transcription is enabled
                            if live_enabled and not batch_only:
                                try:
                                    # Add call_id for client convenience
                                    payload = dict(part)
                                    payload["call_id"] = call_id
                                    payload["type"] = "partial"
                                    # Publish but don't await inside tight loop; event_bus.publish is async
                                    # We will schedule and wait inline via asyncio
                                    import asyncio
                                    asyncio.get_event_loop().create_task(event_bus.publish(call_id, payload))
                                except Exception as e:
                                    logger.warning(f"Failed to publish SSE partial for {call_id}: {e}")
                            if part.get("text"):
                                final_parts.append(part["text"])
                    except StopIteration as e:
                        # Capture the final summary returned by the generator
                        final_summary = e.value
                    
                    # After loop completes, send complete only if live transcription enabled
                    if live_enabled and not batch_only:
                        import asyncio
                        asyncio.get_event_loop().create_task(event_bus.complete(call_id))
                    
                    # Use final_summary if available, otherwise construct from parts
                    if final_summary:
                        # Merge summary metadata with text
                        # Prefer final_summary text (authoritative from generator) over final_parts
                        # Use final_parts only as fallback if summary text is missing
                        summary_text = final_summary.get("text", "").strip()
                        if not summary_text and final_parts:
                            # Fallback to collected parts if summary text is empty
                            summary_text = " ".join(final_parts).strip()
                        
                        return {
                            **final_summary,
                            "text": summary_text,
                        }
                    else:
                        # Fallback if generator didn't return summary
                        return {
                            "audio_path": audio_path,
                            "transcription_success": True,
                            "text": " ".join(final_parts).strip(),
                            "language": "unknown",
                            "transcription_timestamp": datetime.now().isoformat(),
                            "model_used": self.whisper_processor.model_name,
                            "device_used": self.whisper_processor.device,
                        }

                transcription_result = await self._retry_operation(
                    _do_chunked,
                    operation_name="transcription",
                    max_retries=0
                )
            else:
                # Transcribe audio with retry logic (batch)
                # Convert to mono 16k WAV first for reliability on short/varied clips
                try:
                    conv = self.audio_processor.convert_audio_format(
                        audio_path,
                        output_format="wav",
                        sample_rate=16000,
                        channels=1,
                    )
                    wav_path = conv.get("output_path") if conv.get("conversion_success") else audio_path
                    logger.info(f"Using path for transcription: {wav_path} (converted={conv.get('conversion_success')})")
                except Exception as _e:
                    wav_path = audio_path
                    logger.warning(f"Audio conversion before transcription failed; proceeding with original: {audio_path}")

                transcription_result = await self._retry_operation(
                    lambda: self.whisper_processor.transcribe_audio(wav_path),
                    operation_name="transcription",
                    max_retries=2
                )
            
            # Save transcript
            transcript_path = self.whisper_processor.save_transcript(
                call_id, transcription_result
            )
            
            result = {
                "transcript": transcription_result,
                "transcript_path": transcript_path,
                "transcription_text": transcription_result.get("text", ""),
                "language": transcription_result.get("language", "unknown")
            }
            
            # DEBUG: Log what we're storing in pipeline data
            logger.info(f"DEBUG: Storing transcription result in pipeline_data for {call_id}")
            logger.info(f"DEBUG: Transcription text length: {len(result['transcription_text'])}")
            logger.info(f"DEBUG: First 100 chars: {result['transcription_text'][:100]}")
            
            # Store transcription data in pipeline_data for NLP step
            if call_id not in self.pipeline_data:
                self.pipeline_data[call_id] = {}
            self.pipeline_data[call_id]["transcription_data"] = transcription_result
            self.pipeline_data[call_id]["transcription_result"] = result
            
            self.status_tracker.complete_step(call_id, "transcription", result)
            
            # Update monitoring
            pipeline_monitor.update_pipeline_step(call_id, "transcription", "completed", 
                                                self.status_tracker.step_timings[call_id]["transcription"]["duration_seconds"])
            return result
            
        except Exception as e:
            self.status_tracker.fail_step(call_id, "transcription", e)
            self.db_integration.update_call_status(call_id, "failed", additional_data={"error": str(e)})
            raise
    
    async def _step_nlp_analysis(self, call_id: str) -> Dict[str, Any]:
        """
        Step 4: Perform NLP analysis on transcribed text
        """
        self.status_tracker.start_step(call_id, "nlp_analysis")
        
        try:
            logger.info(f"Step 4: Performing NLP analysis for call: {call_id}")
            
            # DEBUG: Log pipeline data structure
            logger.info(f"DEBUG: Pipeline data keys for {call_id}: {list(self.pipeline_data.get(call_id, {}).keys())}")
            
            # Get transcribed text from pipeline data
            if call_id in self.pipeline_data and "transcription_data" in self.pipeline_data[call_id]:
                transcription_data = self.pipeline_data[call_id]["transcription_data"]
                text = transcription_data.get("text", "")
                logger.info(f"DEBUG: Found transcription_data, text length: {len(text)}")
                logger.info(f"DEBUG: First 100 chars of text: {text[:100]}")
            else:
                text = ""
                logger.warning(f"DEBUG: No transcription_data found in pipeline_data for {call_id}")
                # Try to get from transcription result directly
                if call_id in self.pipeline_data and "transcription_result" in self.pipeline_data[call_id]:
                    transcription_result = self.pipeline_data[call_id]["transcription_result"]
                    text = transcription_result.get("transcription_text", "")
                    logger.info(f"DEBUG: Found transcription_result, text length: {len(text)}")
                    logger.info(f"DEBUG: First 100 chars of text: {text[:100]}")
                else:
                    logger.warning(f"DEBUG: No transcription_result found either for {call_id}")
            
            if not text:
                logger.warning(f"No text available for NLP analysis in call: {call_id}")
                result = {
                    "nlp_analysis_completed": False,
                    "error": "No text available for analysis",
                    "analysis_data": {}
                }
                self.status_tracker.complete_step(call_id, "nlp_analysis", result)
                return result

            try:
                load_result = await nlp_processor.ensure_loaded()
                if load_result:
                    logger.info(f"NLP resources loaded for call {call_id}")
            except TimeoutError as exc:
                logger.error(f"NLP resource load timed out for call {call_id}: {exc}")
                raise RuntimeError("NLP resources load timed out") from exc
            except Exception as exc:
                logger.error(f"Failed to prepare NLP resources for call {call_id}: {exc}")
                raise

            # Perform comprehensive NLP analysis
            nlp_analysis = await nlp_processor.analyze_text(text, call_id)
            
            # DEBUG: Log NLP analysis results
            logger.info(f"DEBUG: NLP analysis completed for {call_id}")
            logger.info(f"DEBUG: NLP analysis keys: {list(nlp_analysis.keys())}")
            logger.info(f"DEBUG: Intent: {nlp_analysis.get('intent', {})}")
            logger.info(f"DEBUG: Sentiment: {nlp_analysis.get('sentiment', {})}")
            logger.info(f"DEBUG: Risk: {nlp_analysis.get('risk', {})}")
            
            # Store NLP results in pipeline data
            if call_id not in self.pipeline_data:
                self.pipeline_data[call_id] = {}
            self.pipeline_data[call_id]["nlp_analysis"] = nlp_analysis
            
            result = {
                "nlp_analysis_completed": True,
                "analysis_data": nlp_analysis,
                "text_length": len(text),
                "intent": nlp_analysis.get("intent", {}).get("intent", "unknown"),
                "sentiment": nlp_analysis.get("sentiment", {}).get("sentiment", "neutral"),
                "risk_level": nlp_analysis.get("risk", {}).get("escalation_risk", "low")
            }
            
            # DEBUG: Log final result
            logger.info(f"DEBUG: Final NLP result for {call_id}: intent={result['intent']}, sentiment={result['sentiment']}, risk={result['risk_level']}")
            
            self.status_tracker.complete_step(call_id, "nlp_analysis", result)
            
            # Update monitoring
            pipeline_monitor.update_pipeline_step(call_id, "nlp_analysis", "completed", 
                                                self.status_tracker.step_timings[call_id]["nlp_analysis"]["duration_seconds"])
            return result
            
        except Exception as e:
            self.status_tracker.fail_step(call_id, "nlp_analysis", e)
            raise
    
    async def _step_database_storage(self, call_id: str) -> Dict[str, Any]:
        """
        Step 4: Store all results in database
        """
        self.status_tracker.start_step(call_id, "database_storage")
        
        try:
            logger.info(f"Step 4: Storing results in database for call: {call_id}")
            
            # Store transcript with retry logic
            # Get transcription data from pipeline data
            if call_id in self.pipeline_data and "transcription_data" in self.pipeline_data[call_id]:
                transcription_data = self.pipeline_data[call_id]["transcription_data"]
            else:
                transcription_data = {"text": "", "language": "en", "confidence_score": 0.0}
            
            transcript_result = await self._retry_operation(
                lambda: self.db_integration.store_transcript(call_id, transcription_data),
                operation_name="transcript_storage",
                max_retries=3
            )
            
            # Store analysis results with retry logic
            # Get analysis data from pipeline data
            if call_id in self.pipeline_data and "analysis_result" in self.pipeline_data[call_id]:
                analysis_data = self.pipeline_data[call_id]["analysis_result"]
            else:
                analysis_data = {"duration": 0, "format": "unknown", "sample_rate": 0}
            
            analysis_result = await self._retry_operation(
                lambda: self.db_integration.store_audio_analysis(call_id, analysis_data),
                operation_name="analysis_storage",
                max_retries=3
            )
            
            # Store NLP analysis results with retry logic
            # Get NLP data from pipeline data
            if call_id in self.pipeline_data and "nlp_analysis" in self.pipeline_data[call_id]:
                nlp_data = self.pipeline_data[call_id]["nlp_analysis"]
            else:
                nlp_data = {
                    "intent": {"intent": "unknown", "confidence": 0.0},
                    "sentiment": {"sentiment": "neutral", "sentiment_score": 0},
                    "risk": {"escalation_risk": "low", "risk_score": 0},
                    "keywords": []
                }
            
            nlp_result = await self._retry_operation(
                lambda: self.db_integration.store_nlp_analysis(call_id, nlp_data),
                operation_name="nlp_analysis_storage",
                max_retries=3
            )
            
            # Update final status
            self.db_integration.update_call_status(call_id, "completed")
            
            result = {
                "transcript_stored": transcript_result,
                "analysis_stored": analysis_result,
                "nlp_analysis_stored": nlp_result,
                "database_operations_completed": True
            }
            
            self.status_tracker.complete_step(call_id, "database_storage", result)
            
            # Update monitoring
            pipeline_monitor.update_pipeline_step(call_id, "database_storage", "completed", 
                                                self.status_tracker.step_timings[call_id]["database_storage"]["duration_seconds"])
            return result
            
        except Exception as e:
            self.status_tracker.fail_step(call_id, "database_storage", e)
            self.db_integration.update_call_status(call_id, "failed", additional_data={"error": str(e)})
            raise
    
    async def _retry_operation(self, operation_func, operation_name: str, max_retries: int = 3) -> Any:
        """
        Retry an operation with exponential backoff.
        
        Args:
            operation_func: Function to retry
            operation_name: Name of the operation for logging
            max_retries: Maximum number of retry attempts
            
        Returns:
            Result of the operation
            
        Raises:
            Exception: If all retries fail
        """
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"Attempting {operation_name} (attempt {attempt + 1}/{max_retries + 1})")
                return operation_func()
                
            except Exception as e:
                if attempt == max_retries:
                    logger.error(f"{operation_name} failed after {max_retries + 1} attempts: {e}")
                    raise
                
                wait_time = 2 ** attempt  # Exponential backoff
                logger.warning(f"{operation_name} failed (attempt {attempt + 1}), retrying in {wait_time}s: {e}")
                await asyncio.sleep(wait_time)
    
    def _compile_pipeline_result(
        self, 
        call_id: str, 
        upload_result: Dict, 
        processing_result: Dict, 
        transcription_result: Dict, 
        nlp_result: Dict,
        storage_result: Dict
    ) -> Dict[str, Any]:
        """
        Compile all step results into final pipeline result
        """
        return {
            "call_id": call_id,
            "pipeline_status": "completed",
            "pipeline_summary": {
                "upload": {
                    "file_path": upload_result.get("file_path"),
                    "file_info": upload_result.get("file_info"),
                    "status": "completed"
                },
                "audio_processing": {
                    "analysis_completed": bool(processing_result.get("analysis")),
                    "conversion_completed": bool(processing_result.get("conversion")),
                    "status": "completed"
                },
                "transcription": {
                    "text_length": len(transcription_result.get("transcription_text", "")),
                    "language": transcription_result.get("language"),
                    "status": "completed"
                },
                "nlp_analysis": {
                    "intent": nlp_result.get("intent", "unknown"),
                    "sentiment": nlp_result.get("sentiment", "neutral"),
                    "risk_level": nlp_result.get("risk_level", "low"),
                    "status": "completed"
                },
                "database_storage": {
                    "transcript_stored": storage_result.get("transcript_stored", {}).get("store_success", False),
                    "analysis_stored": storage_result.get("analysis_stored", {}).get("store_success", False),
                    "nlp_analysis_stored": storage_result.get("nlp_analysis_stored", {}).get("store_success", False),
                    "status": "completed"
                }
            },
            "processing_timeline": self.status_tracker.get_pipeline_status(call_id),
            "timestamp": datetime.now().isoformat()
        }
    
    async def _handle_pipeline_error(self, call_id: str, error: Exception):
        """
        Handle pipeline errors gracefully
        """
        logger.error(f"Pipeline error for call {call_id}: {error}")
        
        # Update database status
        try:
            self.db_integration.update_call_status(call_id, "failed", additional_data={"error": str(error)})
        except Exception as db_error:
            logger.error(f"Failed to update database status: {db_error}")
        
        # Log error details
        debug_helper.capture_exception(
            "pipeline_error",
            error,
            {"call_id": call_id, "pipeline_step": "unknown"}
        )
    
    async def _get_file_path(self, call_id: str) -> str:
        """Get file path from database"""
        try:
            db_session = next(self._get_db())
            call_record = db_session.query(Call).filter(Call.call_id == call_id).first()
            
            if not call_record:
                raise ValueError(f"Call record not found for call_id: {call_id}")
            
            if not call_record.file_path:
                raise ValueError(f"No file path found for call_id: {call_id}")
            
            logger.info(f"Retrieved file path for call {call_id}: {call_record.file_path}")
            return call_record.file_path
            
        except Exception as e:
            logger.error(f"Failed to get file path for call {call_id}: {e}")
            raise
    
    async def _get_processed_audio_path(self, call_id: str) -> str:
        """Get processed audio file path from processing results"""
        try:
            # First try to get the original file path
            original_path = await self._get_file_path(call_id)
            
            # Check if processed version exists
            processed_dir = Path(settings.upload_dir) / "processed"
            original_filename = Path(original_path).name
            processed_filename = f"{Path(original_filename).stem}_converted.wav"
            processed_path = processed_dir / processed_filename
            
            # If processed file doesn't exist, use original
            if not processed_path.exists():
                logger.info(f"Processed file not found, using original: {original_path}")
                return original_path
            
            logger.info(f"Using processed audio file: {processed_path}")
            return str(processed_path)
            
        except Exception as e:
            logger.error(f"Failed to get processed audio path for call {call_id}: {e}")
            raise
    
    def _get_db(self):
        """Get database session"""
        from .database import get_db
        return get_db()
    
    def get_pipeline_status(self, call_id: str) -> Dict:
        """Get pipeline status for debugging"""
        return self.status_tracker.get_pipeline_status(call_id)
    
    def get_debug_info(self, call_id: str) -> Dict:
        """Get debug information for troubleshooting"""
        return {
            "pipeline_status": self.get_pipeline_status(call_id),
            "debug_logs": debug_helper.get_debug_info(call_id)
        }
