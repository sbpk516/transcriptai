"""
File upload handling for SignalHub Phase 1.
Provides comprehensive file upload functionality with extensive logging and debugging.
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import aiofiles
from fastapi import UploadFile, HTTPException, Depends
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Call
from .debug_utils import debug_helper, validate_file_upload
from .logging_config import log_function_call, log_file_operation, PerformanceMonitor

# Configure logger for this module
import logging
logger = logging.getLogger('signalhub.upload')

# Import for duration calculation
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
    logger.info("pydub available for duration calculation")
except ImportError:
    PYDUB_AVAILABLE = False
    logger.warning("pydub not available, duration will not be calculated")

# Allowed audio file extensions
ALLOWED_AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"]

# Chunk size for streaming large file uploads (8 MB)
# This prevents loading entire large files into memory
CHUNK_SIZE = 8 * 1024 * 1024  # 8 MB

class AudioUploadHandler:
    """
    Handles audio file uploads with comprehensive validation and logging.
    """
    
    def __init__(self):
        self.upload_dir = Path(settings.upload_dir)
        self.upload_dir.mkdir(exist_ok=True)
        logger.info(f"Audio upload handler initialized with upload directory: {self.upload_dir}")
    
    def _calculate_audio_duration(self, file_path: str) -> Optional[float]:
        """
        Calculate audio duration in seconds using pydub.
        
        Args:
            file_path: Path to the audio file
            
        Returns:
            Duration in seconds, or None if calculation fails
        """
        if not PYDUB_AVAILABLE:
            logger.warning("Cannot calculate duration: pydub not available")
            return None
            
        try:
            audio = AudioSegment.from_file(file_path)
            duration_seconds = len(audio) / 1000.0  # pydub returns milliseconds
            logger.info(f"Calculated duration for {file_path}: {duration_seconds}s")
            return duration_seconds
        except Exception as e:
            logger.error(f"Failed to calculate duration for {file_path}: {e}")
            return None
    
    @log_function_call
    async def validate_upload(self, file: UploadFile) -> Dict[str, Any]:
        """
        Validate uploaded audio file for security and format.
        
        Args:
            file: Uploaded file object
            
        Returns:
            Validation result with file information and any errors
        """
        logger.info(f"Validating upload: {file.filename}")
        
        # Use our debug utility for validation
        validation_result = validate_file_upload(
            file, 
            ALLOWED_AUDIO_EXTENSIONS, 
            settings.max_file_size_bytes
        )
        
        if not validation_result["is_valid"]:
            logger.error(f"File validation failed: {validation_result['errors']}")
            # Log debug information for troubleshooting
            debug_helper.log_debug_info(
                "file_validation_failed",
                {
                    "filename": file.filename,
                    "errors": validation_result["errors"],
                    "file_info": validation_result["file_info"]
                }
            )
        
        return validation_result
    
    @log_file_operation("save_audio_file")
    async def save_audio_file(self, file: UploadFile, call_id: str) -> str:
        """
        Save uploaded audio file to disk with proper organization.
        
        Args:
            file: Uploaded file object
            call_id: Unique call identifier
            
        Returns:
            Path to saved file
        """
        # Create organized file structure: uploads/YYYY/MM/DD/call_id_filename
        today = datetime.now()
        year_month_day = today.strftime("%Y/%m/%d")
        organized_dir = self.upload_dir / year_month_day
        organized_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate safe filename
        file_extension = Path(file.filename).suffix.lower()
        safe_filename = f"{call_id}{file_extension}"
        file_path = organized_dir / safe_filename
        
        logger.info(f"Saving file to: {file_path}")
        
        try:
            # Use chunked streaming to avoid loading entire file into memory
            # This is critical for large files (e.g., 10GB files)
            total_bytes_written = 0
            chunk_count = 0
            last_logged_mb = 0  # Track last logged milestone for progress reporting
            
            async with aiofiles.open(file_path, 'wb') as f:
                while True:
                    # Read chunk from upload stream (up to CHUNK_SIZE bytes)
                    chunk = await file.read(CHUNK_SIZE)
                    
                    # Empty chunk indicates end of file
                    if not chunk:
                        break
                    
                    # Write chunk to disk immediately
                    await f.write(chunk)
                    
                    # Track progress for logging
                    total_bytes_written += len(chunk)
                    chunk_count += 1
                    
                    # Log progress for large files (every 100MB)
                    current_mb = total_bytes_written // (100 * 1024 * 1024)
                    if current_mb > last_logged_mb:
                        last_logged_mb = current_mb
                        logger.debug(
                            f"Upload progress: {total_bytes_written / (1024 * 1024):.2f} MB "
                            f"written ({chunk_count} chunks)"
                        )
            
            logger.info(
                f"File saved successfully: {file_path} "
                f"({total_bytes_written / (1024 * 1024):.2f} MB, {chunk_count} chunks)"
            )
            return str(file_path)
            
        except Exception as e:
            # Clean up partial file if write failed
            if file_path.exists():
                try:
                    file_path.unlink()
                    logger.warning(f"Removed partial file after upload failure: {file_path}")
                except OSError as cleanup_error:
                    logger.error(f"Failed to clean up partial file {file_path}: {cleanup_error}")
            
            logger.error(f"Failed to save file: {e}")
            debug_helper.capture_exception(
                "save_audio_file",
                e,
                {"file_path": str(file_path), "call_id": call_id}
            )
            raise HTTPException(status_code=500, detail="Failed to save file")
    
    @log_function_call
    async def create_call_record(self, db: Session, file_path: str, original_filename: str, call_id: str, file_size_bytes: int) -> Call:
        """
        Create a call record in the database.
        
        Args:
            db: Database session
            file_path: Path to saved audio file
            original_filename: Original uploaded filename
            call_id: Pre-generated call ID to use
            file_size_bytes: Size of the uploaded file in bytes
            
        Returns:
            Created Call object
        """
        # Calculate audio duration
        duration_seconds = self._calculate_audio_duration(file_path)
        
        # Create call record
        call = Call(
            call_id=call_id,
            file_path=file_path,
            original_filename=original_filename,
            file_size_bytes=file_size_bytes,  # Store the file size
            duration=duration_seconds,  # Store the calculated duration
            status="uploaded",  # Initial status
            created_at=datetime.now()
        )
        
        try:
            db.add(call)
            db.commit()
            db.refresh(call)
            
            logger.info(f"Call record created: {call_id} with duration: {duration_seconds}s")
            return call
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to create call record: {e}")
            debug_helper.capture_exception(
                "create_call_record",
                e,
                {"call_id": call_id, "file_path": file_path}
            )
            raise HTTPException(status_code=500, detail="Failed to create call record")

# Global upload handler instance
upload_handler = AudioUploadHandler()

@log_function_call
async def upload_audio_file(
    file: UploadFile,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Main upload endpoint for audio files.
    
    Args:
        file: Uploaded audio file
        db: Database session
        
    Returns:
        Upload result with call information
    """
    logger.info(f"Audio upload request received: {file.filename}")
    
    # Performance monitoring for the entire upload process
    with PerformanceMonitor("audio_upload_process"):
        try:
            # Step 1: Validate file
            validation_result = await upload_handler.validate_upload(file)
            if not validation_result["is_valid"]:
                raise HTTPException(
                    status_code=400, 
                    detail=f"File validation failed: {validation_result['errors']}"
                )
            
            # Step 2: Generate call ID
            call_id = str(uuid.uuid4())
            logger.info(f"Generated call ID: {call_id}")
            
            # Step 3: Save file
            file_path = await upload_handler.save_audio_file(file, call_id)
            
            # Step 4: Create database record
            db_session = next(get_db())
            call = await upload_handler.create_call_record(db_session, file_path, file.filename, call_id, validation_result["file_info"]["size"])
            
            # Step 5: Return success response
            result = {
                "message": "Audio file uploaded successfully",
                "call_id": call.call_id,
                "file_path": call.file_path,
                "status": call.status,
                "uploaded_at": call.created_at.isoformat(),
                "file_info": {
                    "original_filename": file.filename,
                    "file_size": validation_result["file_info"]["size"],
                    "file_extension": validation_result["file_info"]["extension"]
                }
            }
            
            logger.info(f"Upload completed successfully: {call.call_id}")
            return result
            
        except HTTPException:
            # Re-raise HTTP exceptions as-is
            raise
        except Exception as e:
            logger.error(f"Unexpected error during upload: {e}")
            debug_helper.capture_exception(
                "upload_audio_file",
                e,
                {"filename": file.filename if file else "unknown"}
            )
            raise HTTPException(status_code=500, detail="Internal server error during upload")

@log_function_call
async def get_upload_status(call_id: str) -> Dict[str, Any]:
    """
    Get the status of an uploaded call.
    
    Args:
        call_id: Call identifier
        db: Database session
        
    Returns:
        Call status information
    """
    logger.info(f"Getting status for call: {call_id}")
    
    try:
        db_session = next(get_db())
        call = db_session.query(Call).filter(Call.call_id == call_id).first()
        
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        return {
            "call_id": call.call_id,
            "status": call.status,
            "file_path": call.file_path,
            "created_at": call.created_at.isoformat(),
            "updated_at": call.updated_at.isoformat() if call.updated_at else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting call status: {e}")
        debug_helper.capture_exception("get_upload_status", e, {"call_id": call_id})
        raise HTTPException(status_code=500, detail="Internal server error")
