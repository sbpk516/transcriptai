"""
Main FastAPI application for TranscriptAI.
"""
import time
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
import uuid
import asyncio
import logging
import json
import os
from typing import Optional

from .config import settings, get_database_url, is_live_transcription_enabled, is_live_mic_enabled, is_live_batch_only
from .database import get_db, create_tables
from .models import User, Call, Transcript, Analysis
from .upload import upload_audio_file, get_upload_status, upload_handler
from .pipeline_orchestrator import AudioProcessingPipeline
from .pipeline_monitor import pipeline_monitor
from .debug_utils import debug_helper
from .nlp_processor import nlp_processor
from .db_integration import db_integration
from .live_events import event_bus, sse_format
from .live_mic import live_sessions
from .audio_processor import audio_processor
from .whisper_backend_selector import get_global_whisper_processor
from .transcript_formatter import export_transcript
from .api import dictation_router, models
# ... imports ...

# Initialize logging, timers, and core singletons up-front so router registration works during module import.
_MODULE_IMPORT_STARTED = time.perf_counter()
logger = logging.getLogger("app.main")
startup_logger = logging.getLogger("transcriptai.startup")
whisper_processor = get_global_whisper_processor()
_warmup_task: Optional[asyncio.Task] = None

# FastAPI application instance
app = FastAPI(
    title=settings.project_name,
    debug=settings.debug,
)

app.include_router(dictation_router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
# Phase 2: YouTube Integration
from .api.endpoints import youtube
app.include_router(youtube.router, prefix="/api/v1/youtube", tags=["YouTube"])


# Add CORS middleware (for future frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _run_startup_warmup() -> None:
    """Warm up heavyweight models in the background after startup."""
    startup_logger.info("[WARMUP] whisper status=begin")
    try:
        loaded = whisper_processor.ensure_loaded(background=True)
        if loaded:
            startup_logger.info("[WARMUP] whisper status=complete")
        else:
            startup_logger.info("[WARMUP] whisper status=skipped already_loaded=1")
    except Exception as exc:
        startup_logger.error(f"[WARMUP] whisper status=failed error={exc}")

    startup_logger.info("[WARMUP] nlp status=begin")
    try:
        loaded_nlp = await nlp_processor.ensure_loaded(background=True)
        if loaded_nlp:
            startup_logger.info("[WARMUP] nlp status=complete")
        else:
            startup_logger.info("[WARMUP] nlp status=skipped already_loaded=1")
    except Exception as exc:
        startup_logger.error(f"[WARMUP] nlp status=failed error={exc}")

    startup_logger.info("[WARMUP] status=finished")


def _ensure_whisper_ready_for_request(context: str) -> None:
    """Ensure Whisper is loaded before servicing a request context."""
    try:
        loaded = whisper_processor.ensure_loaded()
        if loaded:
            logger.info(f"[WHISPER] model load completed for context={context}")
    except TimeoutError as exc:
        logger.warning(f"[WHISPER] model load timeout context={context}: {exc}")
        raise HTTPException(status_code=503, detail="Speech model is still warming up. Please retry shortly.")
    except Exception as exc:
        logger.error(f"[WHISPER] model unavailable context={context}: {exc}")
        raise HTTPException(status_code=500, detail="Speech model is unavailable. Please try again later.")


async def _ensure_nlp_ready_for_request(context: str) -> None:
    """Ensure NLP resources are loaded before servicing a request context."""
    try:
        loaded = await nlp_processor.ensure_loaded()
        if loaded:
            logger.info(f"[NLP] resources load completed for context={context}")
    except TimeoutError as exc:
        logger.warning(f"[NLP] resources load timeout context={context}: {exc}")
        raise HTTPException(status_code=503, detail="Language analysis is still warming up. Please retry shortly.")
    except Exception as exc:
        logger.error(f"[NLP] resources unavailable context={context}: {exc}")
        raise HTTPException(status_code=500, detail="Language analysis is unavailable. Please try again later.")


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    start_ts = time.perf_counter()
    startup_logger.info("[STARTUP] phase=fastapi_startup status=begin")
    logger.info("Starting TranscriptAI application...")
    try:
        # Log resolved database URL (desktop/sqlite shows file path)
        try:
            db_url = get_database_url()
            if db_url.startswith("sqlite"):
                logger.info(f"Using SQLite DB: {db_url}")
            else:
                # Avoid logging credentials; just note the driver
                driver = db_url.split(":", 1)[0]
                logger.info(f"Using database driver: {driver}")
        except Exception:
            pass

        # Create database tables
        create_tables()
        logger.info("Database tables created successfully")

        # Log feature flags
        logger.info(f"Live transcription (SSE) enabled: {is_live_transcription_enabled()}")
        logger.info(f"Live mic enabled: {is_live_mic_enabled()}")
        logger.info(f"Live mic batch-only: {is_live_batch_only()}")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise
    finally:
        startup_logger.info(
            "[STARTUP] phase=fastapi_startup status=complete elapsed=%.3fs since_import=%.3fs",
            time.perf_counter() - start_ts,
            time.perf_counter() - _MODULE_IMPORT_STARTED,
        )

    try:
        loop = asyncio.get_running_loop()
        global _warmup_task
        _warmup_task = loop.create_task(_run_startup_warmup())
        startup_logger.info("[WARMUP] task scheduled")
    except RuntimeError as exc:
        startup_logger.warning(f"[WARMUP] failed to schedule task: {exc}")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up any background warm-up tasks before shutdown completes."""
    global _warmup_task
    if _warmup_task is None:
        return
    task = _warmup_task
    _warmup_task = None
    if task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        startup_logger.info("[WARMUP] task cancelled on shutdown")
    except Exception as exc:
        startup_logger.warning(f"[WARMUP] task raised during shutdown: {exc}")


@app.get("/")
async def root():
    """Root endpoint - welcome message."""
    return {
        "message": "Welcome to TranscriptAI - Contact Center Intelligence Platform",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        # Test database connection
        db = next(get_db())
        db.execute(text("SELECT 1"))
        db.close()
        return {
            "status": "healthy",
            "database": "connected",
            "features": {
                "live_transcription": is_live_transcription_enabled(),
                "live_mic": is_live_mic_enabled(),
                "live_mic_batch_only": is_live_batch_only(),
            },
            "models": {
                "whisper": whisper_processor.get_status(),
                "nlp": nlp_processor.get_status(),
            },
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail="Service unhealthy")


@app.get("/api/v1/status")
async def api_status():
    """API status endpoint."""
    return {
        "api_version": "v1",
        "status": "active",
        "features": {
            "audio_processing": "planned",
            "speech_to_text": "planned", 
            "nlp_analysis": "planned",
            "real_time_processing": "planned"
        },
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/v1/calls")
async def get_calls(db: Session = Depends(get_db)):
    """Get all calls (placeholder for future implementation)."""
    try:
        calls = db.query(Call).all()
        return {
            "calls": [
                {
                    "id": call.id,
                    "call_id": call.call_id,
                    "status": call.status,
                    "duration": call.duration,
                    "original_filename": call.original_filename,
                    "file_size_bytes": call.file_size_bytes,
                    "created_at": call.created_at.isoformat() if call.created_at else None
                }
                for call in calls
            ],
            "total": len(calls)
        }
    except Exception as e:
        logger.error(f"Failed to get calls: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve calls")


@app.get("/api/v1/calls/{call_id}")
async def get_call(call_id: str, db: Session = Depends(get_db)):
    """Get specific call by ID (placeholder for future implementation)."""
    try:
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        return {
            "id": call.id,
            "call_id": call.call_id,
            "duration": call.duration,
            "status": call.status,
            "created_at": call.created_at.isoformat() if call.created_at else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get call {call_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve call")


@app.get("/api/v1/audio/{call_id}")
async def stream_audio(call_id: str, db: Session = Depends(get_db)):
    """Stream audio file for a specific call."""
    try:
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        if not call.file_path or not os.path.exists(call.file_path):
            raise HTTPException(status_code=404, detail="Audio file not found")
            
        return FileResponse(call.file_path, media_type="audio/wav", filename=call.original_filename or f"{call_id}.wav")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to stream audio for {call_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream audio")


@app.delete("/api/v1/calls/{call_id}")
async def delete_call(call_id: str, db: Session = Depends(get_db)):
    """Delete a call and its associated data (transcript, analysis, audio file)."""
    try:
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        # Delete audio file if it exists
        if call.file_path and os.path.exists(call.file_path):
            try:
                os.remove(call.file_path)
                logger.info(f"Deleted audio file: {call.file_path}")
            except Exception as e:
                logger.error(f"Failed to delete audio file {call.file_path}: {e}")
                # Continue with DB deletion even if file deletion fails
        
        # Delete related records
        # Note: In a real production app, we might want cascading deletes in the DB
        # or soft deletes. For now, we'll manually delete related records.
        db.query(Transcript).filter(Transcript.call_id == call_id).delete()
        db.query(Analysis).filter(Analysis.call_id == call_id).delete()
        
        # Delete call record
        db.delete(call)
        db.commit()
        
        logger.info(f"Successfully deleted call: {call_id}")
        return {"ok": True, "call_id": call_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete call {call_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete call")


# ============================================================================
# PHASE 1: AUDIO UPLOAD ENDPOINTS
# ============================================================================

@app.post("/api/v1/upload")
async def upload_endpoint(file: UploadFile = File(...)):
    """
    Upload audio file for processing.
    
    This endpoint accepts audio files and stores them for processing.
    Supported formats: WAV, MP3, M4A, FLAC, OGG, AAC
    Maximum file size: 10GB
    """
    return await upload_audio_file(file)


@app.get("/api/v1/calls/{call_id}/status")
async def get_call_status(call_id: str):
    """
    Get the processing status of a call.
    
    Returns the current status and metadata for a specific call.
    """
    return await get_upload_status(call_id)


# ============================================================================
# PHASE 0 (Live SSE): Event stream endpoint + mock producer (feature-flagged)
# ============================================================================

@app.get("/api/v1/transcription/stream")
async def transcription_stream(call_id: str):
    """SSE stream of transcription events for a call.

    Requires TRANSCRIPTAI_LIVE_TRANSCRIPTION=1. If disabled, returns 404.
    """
    if not is_live_transcription_enabled():
        raise HTTPException(status_code=404, detail="Live transcription disabled")

    async def event_generator():
        logger.info(f"[SSE] stream open for call_id/session_id={call_id}")
        # Initial ping so clients connect
        yield sse_format("ping", {"ts": datetime.now().isoformat()})
        async for evt in event_bus.subscribe(call_id):
            evt_type = evt.get("type", "partial")
            yield sse_format(evt_type, evt)
        logger.info(f"[SSE] stream closing for call_id/session_id={call_id}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/v1/transcription/mock/start")
async def transcription_mock_start(call_id: str, background: BackgroundTasks, chunks: int = 5, interval_ms: int = 800):
    """Start a mock producer that emits N partial events + complete for demo/testing.

    Only active when TRANSCRIPTAI_LIVE_TRANSCRIPTION=1.
    """
    if not is_live_transcription_enabled():
        raise HTTPException(status_code=404, detail="Live transcription disabled")

    async def producer():
        try:
            for i in range(chunks):
                await asyncio.sleep(max(0, interval_ms) / 1000.0)
                text = f" partial-{i+1}"
                await event_bus.publish(call_id, {
                    "type": "partial",
                    "chunk_index": i,
                    "text": text,
                })
            await event_bus.complete(call_id)
        except Exception as e:
            logger.error(f"mock_producer error: {e}")

    background.add_task(producer)
    return {"status": "started", "call_id": call_id, "chunks": chunks, "interval_ms": interval_ms}


# ============================================================================
# PHASE 1.3: ENHANCED PIPELINE ENDPOINTS
# ============================================================================

@app.post("/api/v1/pipeline/upload")
async def pipeline_upload_endpoint(file: UploadFile = File(...)):
    """
    Enhanced upload endpoint with complete pipeline processing.
    
    This endpoint processes audio through the complete pipeline:
    Upload → Audio Processing → Transcription → Database Storage
    """
    try:
        # Initialize pipeline
        pipeline = AudioProcessingPipeline()
        
        # Process audio through complete pipeline
        result = await pipeline.process_audio_file(file)
        
        return {
            "message": "Audio file processed successfully through complete pipeline",
            "call_id": result["call_id"],
            "status": "completed",
            "pipeline_summary": result["pipeline_summary"],
            "processing_timeline": result["processing_timeline"]
        }
        
    except Exception as e:
        logger.error(f"Pipeline processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/pipeline/{call_id}/status")
async def get_pipeline_status(call_id: str):
    """
    Get detailed pipeline status for debugging.
    
    Returns comprehensive status information for each step in the pipeline.
    """
    try:
        pipeline = AudioProcessingPipeline()
        status = pipeline.get_pipeline_status(call_id)
        
        return {
            "call_id": call_id,
            "pipeline_status": status,
            "debug_info": pipeline.get_debug_info(call_id)
        }
        
    except Exception as e:
        logger.error(f"Failed to get pipeline status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/pipeline/{call_id}/debug")
async def get_pipeline_debug(call_id: str):
    """
    Get comprehensive debug information for troubleshooting.
    
    Returns detailed debug logs, timings, and error information.
    """
    try:
        pipeline = AudioProcessingPipeline()
        debug_info = pipeline.get_debug_info(call_id)
        
        return {
            "call_id": call_id,
            "debug_info": debug_info,
            "debug_logs": debug_helper.get_debug_info(call_id),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get debug info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PHASE A: Mic-based live capture endpoints (feature-flagged)
# ============================================================================

@app.post("/api/v1/live/start")
async def live_start():
    if not is_live_mic_enabled():
        raise HTTPException(status_code=404, detail="Live mic disabled")
    sess = live_sessions.start()
    logger.info(f"[MIC] start session_id={sess.session_id}")
    return {"session_id": sess.session_id}


@app.post("/api/v1/live/chunk")
async def live_chunk(session_id: str, file: UploadFile = File(...)):
    if not is_live_mic_enabled():
        raise HTTPException(status_code=404, detail="Live mic disabled")
    try:
        # Save raw upload to a temp file under session dir
        sess = live_sessions.get(session_id)
        if not sess:
            raise HTTPException(status_code=404, detail="session not found")
        raw_dir = sess.dir / "incoming"
        raw_dir.mkdir(exist_ok=True)
        raw_path = raw_dir / f"{uuid.uuid4()}_{file.filename or 'chunk'}"
        content_type = getattr(file, "content_type", None)
        filename = file.filename or "chunk"
        logger.debug(
            f"[MIC] chunk metadata session_id={session_id} filename={filename} content_type={content_type}"
        )
        content = await file.read()
        content_size = len(content)
        logger.debug(f"[MIC] chunk payload session_id={session_id} bytes={content_size}")
        with open(raw_path, 'wb') as f:
            f.write(content)
        try:
            written_size = raw_path.stat().st_size
        except OSError:
            written_size = None
        idx = live_sessions.add_raw_chunk(session_id, raw_path)
        dest_path = sess.chunks[idx]
        try:
            dest_size = dest_path.stat().st_size
        except OSError:
            dest_size = None
        logger.info(
            f"[MIC] chunk received session_id={session_id} idx={idx} read={content_size}B wrote={written_size}B stored={dest_size}B path={dest_path} ct={content_type}"
        )

        if is_live_batch_only():
            # Batch-only mode: do not transcribe or emit SSE during recording
            # Always defer transcription to stop(); never attempt per-chunk convert
            return {"ok": True, "chunk_index": idx, "batch_only": True}
        else:
            # Give filesystem a moment to flush renamed chunk before conversion
            await asyncio.sleep(0.05)
            
            # Prepare the WAV path (source for transcription)
            wav_path_to_transcribe = None
            temp_merged_path = None
            
            if idx == 0:
                # First chunk (Header + Data): Convert directly
                _ensure_whisper_ready_for_request("live_chunk")
                converted = audio_processor.convert_audio_format(
                    str(sess.chunks[idx]), output_format="wav", sample_rate=16000, channels=1
                )
                wav_path_to_transcribe = converted.get("output_path") if converted.get("conversion_success") else str(sess.chunks[idx])
            else:
                # Subsequent chunks (Headerless WebM Cluster): Merge with Header (Chunk 0)
                # Strategy: Cat(Chunk 0, Chunk N) -> Temp.webm -> Wav -> Transcribe
                try:
                    header_path = sess.chunks[0]
                    current_path = sess.chunks[idx]
                    temp_merged_path = sess.dir / f"temp_merge_{idx}.webm"
                    
                    # Simple binary concatenation of Header + Current Cluster works for connection-oriented WebM
                    with open(temp_merged_path, 'wb') as out_f:
                        with open(header_path, 'rb') as head_f:
                            out_f.write(head_f.read())
                        with open(current_path, 'rb') as curr_f:
                            out_f.write(curr_f.read())
                            
                    _ensure_whisper_ready_for_request("live_chunk_merged")
                    converted = audio_processor.convert_audio_format(
                        str(temp_merged_path), output_format="wav", sample_rate=16000, channels=1
                    )
                    wav_path_to_transcribe = converted.get("output_path") if converted.get("conversion_success") else None
                    
                except Exception as merge_err:
                    logger.warning(f"[MIC] merge failed for idx={idx}: {merge_err}")
            
            if wav_path_to_transcribe:
                # Perform transcription
                part = whisper_processor.transcribe_audio(wav_path_to_transcribe)
                full_text = part.get("text", "") if part.get("transcription_success") else ""
                
                # Logic to extract only NEW text:
                # If idx > 0, the transcription includes the Header (Chunk 0) text.
                # We should subtract the header text to avoid duplication in frontend.
                text_to_emit = full_text
                if idx > 0:
                    header_text = sess.partials[0] if len(sess.partials) > 0 else ""
                    if header_text and full_text.startswith(header_text):
                        text_to_emit = full_text[len(header_text):].strip()
                    # Fallback: if heuristics fail, just stick with full_text (or try overlap detection - kept simple for now)
                
                logger.info(f"[MIC] chunk transcribed session_id={session_id} idx={idx} full_len={len(full_text)} emit_len={len(text_to_emit)}")
                live_sessions.set_partial(session_id, idx, text_to_emit)

                await event_bus.publish(session_id, {
                    "type": "partial",
                    "call_id": session_id,
                    "chunk_index": idx,
                    "text": text_to_emit,
                })
                
                # Cleanup temp files
                if temp_merged_path and temp_merged_path.exists():
                    try:
                        os.unlink(temp_merged_path)
                    except: pass
                # Note: we kept the converted wav of chunk 0 for potential reuse, but for merged chunks we clean up
                if idx > 0 and wav_path_to_transcribe and os.path.exists(wav_path_to_transcribe):
                    try:
                        os.unlink(wav_path_to_transcribe)
                    except: pass
                    
                return {"ok": True, "chunk_index": idx, "text_length": len(text_to_emit)}
            else:
                logger.warning(f"[MIC] chunk skip session_id={session_id} idx={idx} reason=conversion-failed")
                live_sessions.set_partial(session_id, idx, "")
                return {"ok": True, "chunk_index": idx, "skipped": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[MIC] live_chunk failed session_id={session_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/live/stop")
async def live_stop(session_id: str):
    if not is_live_mic_enabled():
        raise HTTPException(status_code=404, detail="Live mic disabled")
    try:
        sess = live_sessions.get(session_id)
        if not sess:
            raise KeyError("session not found")

        if is_live_batch_only():
            # Batch mode: normalize chunks, concatenate, then transcribe once
            from pathlib import Path
            import subprocess

            chunks = list(sess.chunks)
            if not chunks:
                # Nothing recorded
                await event_bus.complete(session_id)
                return {"session_id": session_id, "final_text": ""}

            # Grace period: allow late chunks to finish writing (up to ~1.5s)
            try:
                import time
                t_start = time.time()
                last_count = len(chunks)
                while time.time() - t_start < 1.5:
                    # Re-scan chunks list
                    cur = list(sess.chunks)
                    if len(cur) != last_count:
                        last_count = len(cur)
                        chunks = cur
                        await asyncio.sleep(0.1)
                    else:
                        await asyncio.sleep(0.1)
                logger.info(f"[MIC] stop quiesce complete session_id={session_id} chunks_count={len(chunks)}")
            except Exception:
                pass

            # 1) Concatenate raw WebM chunks into a single file (MediaRecorder blobs share the first header)
            combined_webm = sess.dir / "combined.webm"
            try:
                with open(combined_webm, "wb") as out_f:
                    for i, chunk_path in enumerate(chunks):
                        try:
                            with open(chunk_path, "rb") as in_f:
                                data = in_f.read()
                                out_f.write(data)
                                logger.debug(
                                    f"[MIC] concat append session_id={session_id} chunk_idx={i} bytes={len(data)}"
                                )
                        except Exception as e:
                            logger.error(f"[MIC] concat read failed chunk {i}: {e}")
                            raise
            except Exception as e:
                logger.error(f"[MIC] failed to concatenate webm chunks: {e}")
                raise HTTPException(status_code=500, detail="audio_concat_failed")

            # 2) Transcode combined WebM to single WAV
            combined_path = sess.dir / "combined.wav"
            concat_ok = False
            try:
                cmd = [
                    "ffmpeg",
                    "-i", str(combined_webm),
                    "-fflags", "+genpts",
                    "-avoid_negative_ts", "make_zero",
                    "-ar", "16000",
                    "-ac", "1",
                    "-y", str(combined_path),
                ]
                logger.info(f"[MIC] ffmpeg transcode combined: {' '.join(cmd)}")
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    logger.error(f"[MIC] transcode failed: {proc.stderr}")
                    raise HTTPException(status_code=500, detail="audio_concat_failed")
                combined_to_use = str(combined_path)
                concat_ok = True
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"[MIC] transcode exception: {e}")
                combined_to_use = str(chunks[0])

            # 4) Single transcription pass
            _ensure_whisper_ready_for_request("live_stop")
            tr = whisper_processor.transcribe_audio(combined_to_use)
            final_text = (tr.get("text") or "").strip() if tr.get("transcription_success") else ""
            logger.info(f"[MIC] stop batch session_id={session_id} final_text_len={len(final_text)}")

            # 5) Save transcript JSON (using session_id as call_id)
            try:
                save = whisper_processor.save_transcript(session_id, tr)
                transcript_path = save.get("transcript_path")
            except Exception:
                transcript_path = None

            # 6) Persist to DB so it appears in Results
            call_id = session_id  # reuse session_id as call_id for traceability
            db_session = None
            try:
                import os as _os
                from .database import get_db as _get_db
                db_session = next(_get_db())
                original_filename = f"live_mic_{call_id}.wav"
                try:
                    file_size_bytes = _os.path.getsize(combined_to_use)
                except Exception:
                    file_size_bytes = 0
                # Create Call row (status 'uploaded')
                await upload_handler.create_call_record(
                    db_session,
                    combined_to_use,
                    original_filename,
                    call_id,
                    file_size_bytes,
                )
            except Exception as e:
                logger.warning(f"[MIC] failed to create Call record for {call_id}: {e}")
            finally:
                try:
                    if db_session:
                        db_session.close()
                except Exception:
                    pass

            # Store transcript row
            try:
                db_integration.store_transcript(call_id, tr)
            except Exception as e:
                logger.warning(f"[MIC] failed to store transcript for {call_id}: {e}")

            analysis_summary = None
            try:
                if final_text:
                    logger.info(f"[MIC] running NLP analysis for session_id={session_id}")
                    await _ensure_nlp_ready_for_request("live_stop")
                    analysis_summary = await nlp_processor.analyze_text(final_text, call_id)
                    store_result = db_integration.store_nlp_analysis(call_id, analysis_summary)
                    if not store_result.get('store_success'):
                        logger.warning(
                            f"[MIC] failed to persist NLP analysis for {call_id}: {store_result.get('error') or 'unknown error'}"
                        )
                else:
                    logger.info(f"[MIC] skipping NLP analysis for session_id={session_id}: empty transcript")
            except Exception as e:
                logger.warning(f"[MIC] NLP analysis failed for {call_id}: {e}")
                analysis_summary = None

            # Update duration and mark completed
            try:
                analysis = audio_processor.analyze_audio_file(combined_to_use)
                duration = float(analysis.get("duration_seconds") or 0)
            except Exception:
                analysis = {}
                duration = None
            try:
                db_integration.update_call_status(call_id, "completed", duration=duration)
            except Exception as e:
                logger.warning(f"[MIC] failed to update call status for {call_id}: {e}")

            # Mark SSE stream completed for any listeners (harmless if unused)
            await event_bus.complete(session_id)
            return {
                "session_id": session_id,
                "final_text": final_text,
                "transcript_path": transcript_path,
                "combined_path": str(combined_to_use),
                "call_id": call_id,
                "chunks_count": len(chunks),
                "concat_ok": concat_ok,
                "duration_seconds": duration,
                "nlp_analysis": analysis_summary,
            }
        else:
            # Legacy incremental mode: concatenate partials already captured
            out = live_sessions.stop(session_id)
            logger.info(f"[MIC] stop session_id={session_id} final_text_len={len(out.get('final_text') or '')}")
            await event_bus.complete(session_id)
            return {"session_id": session_id, "final_text": out.get("final_text", "")}
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found")
    except Exception as e:
        logger.error(f"[MIC] live_stop failed session_id={session_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/live/debug/session")
async def live_debug_session(session_id: str):
    """Debug endpoint: inspect a live session's internal state (counts, snippets)."""
    if not is_live_mic_enabled():
        raise HTTPException(status_code=404, detail="Live mic disabled")
    sess = live_sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    partials = sess.partials or []
    return {
        "session_id": session_id,
        "chunks_count": len(sess.chunks),
        "partials_count": len(partials),
        "partials_lens": [len(p or '') for p in partials],
        "last_partial_preview": (partials[-1][:60] if partials and partials[-1] else ""),
    }


@app.get("/api/v1/monitor/active")
async def get_active_pipelines():
    """
    Get currently active pipelines with real-time status.
    
    Returns information about all pipelines currently being processed.
    """
    try:
        active_pipelines = pipeline_monitor.get_active_pipelines()
        
        return {
            "active_pipelines": active_pipelines,
            "count": len(active_pipelines),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get active pipelines: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/monitor/history")
async def get_pipeline_history(limit: int = 50):
    """
    Get recent pipeline history.
    
    Returns information about recently completed or failed pipelines.
    """
    try:
        history = pipeline_monitor.get_pipeline_history(limit)
        
        return {
            "pipeline_history": history,
            "count": len(history),
            "limit": limit,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get pipeline history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/pipeline/reanalyze/{call_id}")
async def reanalyze_call(call_id: str, db: Session = Depends(get_db)):
    """
    Re-run NLP analysis for an existing call using its stored transcript.
    - Looks up transcript by call_id
    - Runs NLP analysis via nlp_processor
    - Persists results via DatabaseIntegration
    - Returns the newly stored analysis summary

    Note: This adds another entry to the analyses table for the call.
    """
    try:
        logger.info(f"[REANALYZE] Request received for call_id: {call_id}")

        # Validate call exists
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")

        # Get transcript text
        transcript_record = db.query(Transcript).filter(Transcript.call_id == call_id).first()
        if not transcript_record or not (transcript_record.text or '').strip():
            # Return a friendly 200 response instead of 400 for empty transcripts
            return {
                "message": "No transcript available",
                "call_id": call_id,
                "analysis": None,
                "timestamp": datetime.now().isoformat()
            }

        text = transcript_record.text
        logger.info(f"[REANALYZE] Transcript loaded (len={len(text)}) for call {call_id}")

        # Run NLP analysis
        await _ensure_nlp_ready_for_request("reanalyze")
        analysis = await nlp_processor.analyze_text(text, call_id)
        logger.info(f"[REANALYZE] NLP analysis completed for call {call_id}")

        # Store NLP analysis
        store_result = db_integration.store_nlp_analysis(call_id, analysis)
        logger.info(f"[REANALYZE] NLP analysis stored for call {call_id}: success={store_result.get('store_success')}")

        if not store_result.get('store_success'):
            err = store_result.get('error', 'Unknown error while storing analysis')
            raise HTTPException(status_code=500, detail=f"Failed to store analysis: {err}")

        # Build API response
        response = {
            "call_id": call_id,
            "stored": store_result.get("store_success", False),
            "analysis": {
                "sentiment": analysis.get("sentiment", {}),
                "intent": analysis.get("intent", {}),
                "risk": analysis.get("risk", {}),
                "keywords": analysis.get("keywords", [])
            },
            "store_result": store_result
        }

        return {"message": "Reanalysis completed", "data": response, "timestamp": datetime.now().isoformat()}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[REANALYZE] Failed for call {call_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to reanalyze call: {str(e)}")


@app.get("/api/v1/monitor/performance")
async def get_performance_summary():
    """
    Get performance summary and system metrics.
    
    Returns comprehensive performance statistics and system resource usage.
    """
    try:
        performance_summary = pipeline_monitor.get_performance_summary()
        
        return {
            "performance_summary": performance_summary,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get performance summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/monitor/alerts")
async def get_recent_alerts():
    """
    Get recent system alerts.
    
    Returns recent alerts for slow operations, high resource usage, etc.
    """
    try:
        alerts = list(pipeline_monitor.alerts)[-20:]  # Last 20 alerts
        
        return {
            "alerts": alerts,
            "count": len(alerts),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get alerts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PHASE 2: RESULTS ENDPOINTS (Debug-First Implementation)
# ============================================================================

# Helper function to format file sizes
def _format_file_size(file_size_bytes: int) -> str:
    """Format file size in bytes to human readable format."""
    if not file_size_bytes or file_size_bytes <= 0:
        return "Unknown"
    
    if file_size_bytes < 1024:
        return f"{file_size_bytes} B"
    elif file_size_bytes < 1024 * 1024:
        return f"{file_size_bytes // 1024} KB"
    else:
        return f"{file_size_bytes // (1024 * 1024):.1f} MB"

# Helper function to format duration
def _format_duration(duration_seconds: int) -> str:
    """Format duration in seconds to human readable format."""
    if not duration_seconds or duration_seconds <= 0:
        return "Unknown"
    
    if duration_seconds < 60:
        return f"{duration_seconds}s"
    else:
        minutes = duration_seconds // 60
        seconds = duration_seconds % 60
        return f"{minutes}m {seconds}s"

@app.get("/api/v1/pipeline/results")
async def get_pipeline_results(
    status: str = None,
    date_from: str = None,
    date_to: str = None,
    search: str = None,
    sort: str = "created_at",
    direction: str = "desc",
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """
    Get all pipeline results with filtering and pagination.
    
    This is a DEBUG-FIRST implementation with extensive logging.
    """
    try:
        logger.info(
            f"[RESULTS API] Request received - status: {status}, date_from: {date_from}, date_to: {date_to}, "
            f"search: {search}, sort: {sort}, direction: {direction}, limit: {limit}, offset: {offset}"
        )
        
        # Start building base query
        base_query = db.query(Call)
        
        # Apply filters with logging
        if status:
            logger.info(f"[RESULTS API] Applying status filter: {status}")
            base_query = base_query.filter(Call.status == status)
        
        if date_from:
            logger.info(f"[RESULTS API] Applying date_from filter: {date_from}")
            # Convert string to datetime for comparison
            from_date = datetime.fromisoformat(date_from)
            base_query = base_query.filter(Call.created_at >= from_date)
        
        if date_to:
            logger.info(f"[RESULTS API] Applying date_to filter: {date_to}")
            # Convert string to datetime for comparison
            to_date = datetime.fromisoformat(date_to)
            base_query = base_query.filter(Call.created_at <= to_date)
        
        # Get total count before pagination
        total_count = base_query.count()
        logger.info(f"[RESULTS API] Total records found: {total_count}")
        
        # Determine ordering (default: created_at DESC with nulls last)
        order_col = None
        sort_normalized = (sort or "created_at").lower()
        direction_normalized = (direction or "desc").lower()

        if sort_normalized == "created_at":
            order_col = Call.created_at
        else:
            logger.warning(f"[RESULTS API] Unsupported sort field '{sort}'. Falling back to 'created_at'.")
            order_col = Call.created_at

        if direction_normalized not in ("asc", "desc"):
            logger.warning(f"[RESULTS API] Unsupported direction '{direction}'. Falling back to 'desc'.")
            direction_normalized = "desc"

        # Build ordered query with stable tiebreaker and nulls last
        primary_order = (order_col.asc() if direction_normalized == "asc" else order_col.desc()).nullslast()
        tie_breaker = Call.id.asc() if direction_normalized == "asc" else Call.id.desc()

        logger.info(
            f"[RESULTS API] Applying ordering - sort: {sort_normalized} {direction_normalized} (nulls last), tiebreaker on id"
        )

        ordered_query = base_query.order_by(primary_order, tie_breaker)

        # Apply pagination
        paged_query = ordered_query.offset(offset).limit(limit)
        logger.info(f"[RESULTS API] Applied pagination - offset: {offset}, limit: {limit}")
        
        # Execute query
        calls = paged_query.all()
        logger.info(f"[RESULTS API] Retrieved {len(calls)} calls from database")
        if calls:
            try:
                first_created = calls[0].created_at.isoformat() if calls[0].created_at else None
                last_created = calls[-1].created_at.isoformat() if calls[-1].created_at else None
                logger.debug(
                    f"[RESULTS API] Page sample created_at - first: {first_created}, last: {last_created}"
                )
            except Exception as log_err:
                logger.debug(f"[RESULTS API] Unable to log page sample created_at: {log_err}")
        
        # Convert to response format
        results = []
        for call in calls:
            try:
                # Get transcript for this call
                transcript = None
                try:
                    transcript_record = db.query(Transcript).filter(Transcript.call_id == call.call_id).first()
                    if transcript_record and transcript_record.text:
                        transcript = {
                            "transcription_text": transcript_record.text,
                            "confidence": transcript_record.confidence or 0,
                            "language": transcript_record.language or "en"
                        }
                except Exception as transcript_err:
                    logger.debug(f"[RESULTS API] Could not fetch transcript for {call.call_id}: {transcript_err}")
                
                # Get analysis for this call
                analysis = None
                try:
                    from .models import Analysis
                    analysis_record = db.query(Analysis).filter(Analysis.call_id == call.call_id).first()
                    if analysis_record:
                        try:
                            keywords = json.loads(analysis_record.keywords) if analysis_record.keywords else []
                        except Exception:
                            keywords = []
                        try:
                            topics = json.loads(analysis_record.topics) if analysis_record.topics else []
                        except Exception:
                            topics = []
                        analysis = {
                            "sentiment": {
                                "overall": analysis_record.sentiment or "neutral",
                                "score": analysis_record.sentiment_score or 0
                            },
                            "intent": {
                                "detected": analysis_record.intent or "unknown",
                                "confidence": (analysis_record.intent_confidence or 0) / 100.0
                            },
                            "risk": {
                                "escalation_risk": analysis_record.escalation_risk or "low",
                                "risk_score": analysis_record.risk_score or 0,
                                "urgency_level": analysis_record.urgency_level or "low",
                                "compliance_risk": analysis_record.compliance_risk or "none"
                            },
                            "keywords": keywords,
                            "topics": topics
                        }
                except Exception as analysis_err:
                    logger.debug(f"[RESULTS API] Could not fetch analysis for {call.call_id}: {analysis_err}")
                
                result = {
                    "call_id": call.call_id,
                    "status": call.status,
                    "created_at": call.created_at.isoformat() if call.created_at else None,
                    "file_info": {
                        "file_path": call.file_path,
                        "original_filename": getattr(call, 'original_filename', None),
                        "file_size_bytes": call.file_size_bytes or 0,
                        "file_size": _format_file_size(call.file_size_bytes)
                    },
                    "audio_analysis": {
                        "duration_seconds": call.duration or 0,
                        "duration": _format_duration(call.duration)
                    },
                    "transcription": transcript,
                    "nlp_analysis": analysis
                }
                results.append(result)
                logger.debug(f"[RESULTS API] Processed call {call.call_id} successfully")
            except Exception as call_error:
                logger.error(f"[RESULTS API] Error processing call {call.call_id}: {call_error}")
                # Continue processing other calls instead of failing completely
                continue
        
        logger.info(f"[RESULTS API] Successfully processed {len(results)} results")
        
        response = {
            "data": {
                "results": results,
                "total": total_count,
                "page": (offset // limit) + 1,
                "pageSize": limit
            }
        }
        
        logger.info(f"[RESULTS API] Response prepared successfully - returning {len(results)} results out of {total_count} total")
        return response
        
    except Exception as e:
        logger.error(f"[RESULTS API] Critical error in get_pipeline_results: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve results: {str(e)}")


@app.get("/api/v1/pipeline/results/{call_id}")
async def get_pipeline_result_detail(
    call_id: str,
    db: Session = Depends(get_db)
):
    """
    Get detailed information for a specific pipeline result.
    
    This is a DEBUG-FIRST implementation with extensive logging.
    """
    try:
        logger.info(f"[RESULTS API] Detail request received for call_id: {call_id}")
        
        # Get call record
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            logger.warning(f"[RESULTS API] Call not found: {call_id}")
            raise HTTPException(status_code=404, detail="Call not found")
        
        logger.info(f"[RESULTS API] Call found: {call_id}, status: {call.status}")
        
        # Get related transcript if exists
        transcript = None
        try:
            transcript_record = db.query(Transcript).filter(Transcript.call_id == call_id).first()
            if transcript_record:
                # Map model field `text` to API field `transcription_text` expected by frontend
                transcript = {
                    "transcription_text": transcript_record.text or "",
                    "confidence": transcript_record.confidence or 0,
                    "language": transcript_record.language or "en"
                }
                logger.info(f"[RESULTS API] Transcript found for call {call_id}")
            else:
                logger.info(f"[RESULTS API] No transcript found for call {call_id}")
        except Exception as transcript_error:
            logger.error(f"[RESULTS API] Error retrieving transcript for call {call_id}: {transcript_error}")
            # Don't fail the entire request if transcript retrieval fails
        
        # Get related analysis if exists
        analysis = None
        try:
            analysis_record = db.query(Analysis).filter(Analysis.call_id == call_id).first()
            if analysis_record:
                # Parse keywords/topics JSON safely
                try:
                    keywords = json.loads(analysis_record.keywords) if analysis_record.keywords else []
                except Exception:
                    keywords = []
                try:
                    topics = json.loads(analysis_record.topics) if analysis_record.topics else []
                except Exception:
                    topics = []

                analysis = {
                    "sentiment": {
                        "overall": analysis_record.sentiment or "neutral",
                        "score": analysis_record.sentiment_score or 0
                    },
                    "intent": {
                        "detected": analysis_record.intent or "unknown",
                        "confidence": (analysis_record.intent_confidence or 0) / 100.0
                    },
                    "risk": {
                        "escalation_risk": analysis_record.escalation_risk or "low",
                        "risk_score": analysis_record.risk_score or 0,
                        "urgency_level": analysis_record.urgency_level or "low",
                        "compliance_risk": analysis_record.compliance_risk or "none"
                    },
                    "keywords": keywords,
                    "topics": topics
                }
                logger.info(f"[RESULTS API] Analysis found for call {call_id}")
            else:
                logger.info(f"[RESULTS API] No analysis found for call {call_id}")
        except Exception as analysis_error:
            logger.error(f"[RESULTS API] Error retrieving analysis for call {call_id}: {analysis_error}")
            # Don't fail the entire request if analysis retrieval fails
        
        # Build response
        result = {
            "call_id": call.call_id,
            "status": call.status,
            "created_at": call.created_at.isoformat() if call.created_at else None,
            "file_info": {
                "file_path": call.file_path,
                "original_filename": getattr(call, 'original_filename', None),
                "file_size_bytes": call.file_size_bytes or 0,
                "file_size": _format_file_size(call.file_size_bytes)
            },
            "audio_analysis": {
                "duration_seconds": call.duration or 0,
                "duration": _format_duration(call.duration)
            },
            "transcription": transcript,
            "nlp_analysis": analysis
        }
        
        logger.info(f"[RESULTS API] Successfully prepared detail response for call {call_id}")
        return {"data": result}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[RESULTS API] Critical error in get_pipeline_result_detail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve result details: {str(e)}")


@app.get("/api/v1/pipeline/results/{call_id}/export")
async def export_pipeline_result(
    call_id: str,
    format: str = "txt",
    db: Session = Depends(get_db)
):
    """
    Export transcript in TXT, DOCX, or PDF format.

    Args:
        call_id: The call ID to export
        format: Export format ('txt', 'docx', 'pdf')

    Returns:
        File download response
    """
    try:
        logger.info(f"[EXPORT API] Export request for call_id: {call_id}, format: {format}")

        # Validate format
        format = format.lower().strip()
        if format not in ('txt', 'docx', 'pdf'):
            raise HTTPException(status_code=400, detail=f"Invalid format: {format}. Use 'txt', 'docx', or 'pdf'.")

        # Get call record
        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            logger.warning(f"[EXPORT API] Call not found: {call_id}")
            raise HTTPException(status_code=404, detail="Call not found")

        # Get transcript
        transcript_record = db.query(Transcript).filter(Transcript.call_id == call_id).first()
        if not transcript_record or not transcript_record.text:
            logger.warning(f"[EXPORT API] No transcript found for call: {call_id}")
            raise HTTPException(status_code=404, detail="Transcript not found")

        # Get filename for title generation
        original_filename = getattr(call, 'original_filename', None) or call.file_path
        if original_filename and '/' in original_filename:
            original_filename = original_filename.split('/')[-1]

        # Generate export
        file_bytes, content_type, suggested_filename = export_transcript(
            text=transcript_record.text,
            format=format,
            filename=original_filename
        )

        logger.info(f"[EXPORT API] Successfully generated {format.upper()} for call {call_id}")

        # Return as downloadable file
        return StreamingResponse(
            iter([file_bytes]),
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{suggested_filename}"',
                "Content-Length": str(len(file_bytes))
            }
        )

    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"[EXPORT API] Missing dependency: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[EXPORT API] Export failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@app.delete("/api/v1/pipeline/results/{call_id}")
async def delete_pipeline_result(call_id: str, db: Session = Depends(get_db)):
    """
    Delete a single pipeline result by call_id.

    - Removes related Transcript and Analysis rows
    - Removes Call row
    - Deletes associated audio files from disk (original and processed)
    """
    try:
        logger.info(f"[RESULTS API] Delete request received for call_id: {call_id}")

        call = db.query(Call).filter(Call.call_id == call_id).first()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")

        # Track files to delete
        files_deleted = []
        files_errors = []

        # Delete original file if exists
        try:
            if call.file_path and os.path.exists(call.file_path):
                os.remove(call.file_path)
                files_deleted.append(call.file_path)
        except Exception as fe:
            files_errors.append({"file": call.file_path, "error": str(fe)})

        # Delete processed files matching call_id stem
        try:
            from pathlib import Path
            processed_dir = Path(settings.upload_dir) / "processed"
            stem = Path(call.file_path).stem if call.file_path else call_id
            if processed_dir.exists():
                for p in processed_dir.glob(f"{stem}*"):
                    try:
                        os.remove(p)
                        files_deleted.append(str(p))
                    except Exception as pe:
                        files_errors.append({"file": str(p), "error": str(pe)})
        except Exception as pe:
            files_errors.append({"file": "processed_glob", "error": str(pe)})

        # Delete related DB rows (child tables first)
        try:
            db.query(Transcript).filter(Transcript.call_id == call_id).delete()
            db.query(Analysis).filter(Analysis.call_id == call_id).delete()
            db.query(Call).filter(Call.call_id == call_id).delete()
            db.commit()
        except Exception as de:
            db.rollback()
            logger.error(f"[RESULTS API] DB deletion failed for {call_id}: {de}")
            raise HTTPException(status_code=500, detail="Failed to delete database records")

        logger.info(f"[RESULTS API] Deleted call {call_id}. Files removed: {len(files_deleted)}")
        return {
            "message": "Result deleted",
            "data": {
                "call_id": call_id,
                "files_deleted": files_deleted,
                "file_errors": files_errors
            },
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[RESULTS API] Critical error in delete_pipeline_result: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete result: {str(e)}")


@app.delete("/api/v1/pipeline/results")
async def clear_all_results(db: Session = Depends(get_db)):
    """
    Clear all pipeline results from the database and remove uploaded/processed files.

    This will:
    - TRUNCATE or delete rows from analyses, transcripts, and calls
    - Remove files under `upload_dir` (and its `processed` subdir)
    """
    try:
        logger.warning("[RESULTS API] CLEAR ALL request received — deleting all results and files")

        # 1) Remove files under upload directory
        file_delete_count = 0
        file_errors = []
        try:
            from pathlib import Path
            base = Path(settings.upload_dir)
            if base.exists():
                for path in sorted(base.rglob("*"), key=lambda p: len(str(p)), reverse=True):
                    # Delete files first, then empty dirs
                    try:
                        if path.is_file():
                            os.remove(path)
                            file_delete_count += 1
                        elif path.is_dir():
                            # Only remove empty directories
                            try:
                                path.rmdir()
                            except OSError:
                                # Directory not empty; continue
                                pass
                    except Exception as fe:
                        file_errors.append({"path": str(path), "error": str(fe)})
        except Exception as e:
            logger.error(f"[RESULTS API] Error clearing files: {e}")
            file_errors.append({"path": str(settings.upload_dir), "error": str(e)})

        # 2) Delete database rows (children first)
        try:
            db.query(Analysis).delete()
            db.query(Transcript).delete()
            db.query(Call).delete()
            db.commit()
        except Exception as de:
            db.rollback()
            logger.error(f"[RESULTS API] DB clear failed: {de}")
            raise HTTPException(status_code=500, detail="Failed to clear database")

        return {
            "message": "All results cleared",
            "data": {
                "files_deleted": file_delete_count,
                "file_errors": file_errors
            },
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[RESULTS API] Critical error in clear_all_results: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to clear results: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
