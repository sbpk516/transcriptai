"""
Debugging utilities for TranscriptAI development.
Provides tools for easy debugging and troubleshooting.
"""
import os
import sys
import traceback
import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from pathlib import Path
import os

class DebugHelper:
    """Helper class for debugging operations."""
    
    def __init__(self, debug_dir: str = "debug_logs"):
        # Resolve a writable debug directory
        data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
        if data_dir:
            base = Path(data_dir) / "logs"
        else:
            # Fallback to user home if CWD is read-only (e.g., packaged app bundle)
            base = Path.home() / "Library" / "Application Support" / "TranscriptAI" / "logs" if sys.platform == "darwin" else Path.cwd() / "logs"
        self.debug_dir = base
        try:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            # Last resort: temp directory
            import tempfile
            self.debug_dir = Path(tempfile.gettempdir()) / "transcriptai_logs"
            self.debug_dir.mkdir(parents=True, exist_ok=True)
    
    def log_debug_info(self, operation: str, data: Dict[str, Any], filename: Optional[str] = None):
        """
        Log debug information to a file for later analysis.
        
        Args:
            operation: Name of the operation being debugged
            data: Data to log
            filename: Optional custom filename
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = filename or f"{operation}_{timestamp}.json"
        filepath = self.debug_dir / filename
        
        debug_data = {
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "data": data,
            "python_version": sys.version,
            "platform": sys.platform
        }
        
        with open(filepath, 'w') as f:
            json.dump(debug_data, f, indent=2, default=str)
        
        print(f"Debug info saved to: {filepath}")
    
    def capture_exception(self, operation: str, exception: Exception, context: Dict[str, Any] = None):
        """
        Capture exception details for debugging.
        
        Args:
            operation: Name of the operation that failed
            exception: The exception that occurred
            context: Additional context information
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"error_{operation}_{timestamp}.json"
        filepath = self.debug_dir / filename
        
        error_data = {
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "exception_type": type(exception).__name__,
            "exception_message": str(exception),
            "traceback": traceback.format_exc(),
            "context": context or {},
            "python_version": sys.version,
            "platform": sys.platform
        }
        
        with open(filepath, 'w') as f:
            json.dump(error_data, f, indent=2, default=str)
        
        print(f"Error details saved to: {filepath}")
        return filepath

def validate_file_upload(file, allowed_extensions: List[str], max_size: int) -> Dict[str, Any]:
    """
    Validate uploaded file for security and format.
    
    Args:
        file: Uploaded file object
        allowed_extensions: List of allowed file extensions
        max_size: Maximum file size in bytes
    
    Returns:
        Dict with validation results and any errors
    """
    validation_result = {
        "is_valid": True,
        "errors": [],
        "file_info": {}
    }
    
    try:
        # Check if file exists
        if not file or not file.filename:
            validation_result["is_valid"] = False
            validation_result["errors"].append("No file provided")
            return validation_result
        
        # Get file extension
        file_extension = Path(file.filename).suffix.lower()
        validation_result["file_info"]["extension"] = file_extension
        validation_result["file_info"]["filename"] = file.filename
        
        # Check file extension
        if file_extension not in allowed_extensions:
            validation_result["is_valid"] = False
            validation_result["errors"].append(f"File extension {file_extension} not allowed. Allowed: {allowed_extensions}")
        
        # Check file size - FastAPI UploadFile has size attribute
        if hasattr(file, 'size'):
            file_size = file.size
        else:
            # Fallback for regular file objects
            file.seek(0, 2)  # Seek to end
            file_size = file.tell()
            file.seek(0)  # Reset to beginning
        
        validation_result["file_info"]["size"] = file_size
        
        if file_size > max_size:
            validation_result["is_valid"] = False
            # Format file sizes in human-readable format
            def format_size(bytes_size: int) -> str:
                if bytes_size >= 1024 * 1024 * 1024:
                    return f"{bytes_size / (1024 * 1024 * 1024):.2f} GB"
                elif bytes_size >= 1024 * 1024:
                    return f"{bytes_size / (1024 * 1024):.2f} MB"
                elif bytes_size >= 1024:
                    return f"{bytes_size / 1024:.2f} KB"
                else:
                    return f"{bytes_size} bytes"
            
            file_size_str = format_size(file_size)
            max_size_str = format_size(max_size)
            validation_result["errors"].append(f"File size ({file_size_str}) exceeds maximum allowed size ({max_size_str})")
        
        # Check for suspicious file names
        suspicious_patterns = ["..", "/", "\\", ":", "*", "?", "\"", "<", ">", "|"]
        for pattern in suspicious_patterns:
            if pattern in file.filename:
                validation_result["is_valid"] = False
                validation_result["errors"].append(f"Suspicious characters in filename: {pattern}")
                break
        
    except Exception as e:
        validation_result["is_valid"] = False
        validation_result["errors"].append(f"Validation error: {str(e)}")
    
    return validation_result

def create_test_audio_file(duration_seconds: int = 5, filename: str = "test_audio.wav") -> str:
    """
    Create a test audio file for development and testing.
    
    Args:
        duration_seconds: Duration of the test audio in seconds
        filename: Name of the test file
    
    Returns:
        Path to the created test file
    """
    try:
        import numpy as np
        import wave
        
        # Create a simple sine wave
        sample_rate = 44100
        frequency = 440  # A4 note
        samples = int(duration_seconds * sample_rate)
        t = np.linspace(0, duration_seconds, samples, False)
        audio_data = np.sin(2 * np.pi * frequency * t)
        
        # Convert to 16-bit integers
        audio_data = (audio_data * 32767).astype(np.int16)
        
        # Save as WAV file
        test_dir = Path("test_files")
        test_dir.mkdir(exist_ok=True)
        
        filepath = test_dir / filename
        
        with wave.open(str(filepath), 'w') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_data.tobytes())
        
        print(f"Test audio file created: {filepath}")
        return str(filepath)
        
    except ImportError:
        print("Warning: numpy not available, cannot create test audio file")
        return None
    except Exception as e:
        print(f"Error creating test audio file: {e}")
        return None

def check_system_requirements() -> Dict[str, Any]:
    """
    Check if all system requirements are met for audio processing.
    
    Returns:
        Dict with requirement check results
    """
    requirements = {
        "ffmpeg": False,
        "whisper": False,
        "audio_libraries": False,
        "disk_space": False,
        "python_packages": {}
    }
    
    # Check FFmpeg
    try:
        import subprocess
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        requirements["ffmpeg"] = result.returncode == 0
    except FileNotFoundError:
        requirements["ffmpeg"] = False
    
    # Check Whisper
    try:
        import whisper
        requirements["whisper"] = True
        requirements["python_packages"]["whisper"] = True
    except ImportError:
        requirements["whisper"] = False
        requirements["python_packages"]["whisper"] = False
    
    # Check audio libraries
    try:
        import librosa
        requirements["audio_libraries"] = True
        requirements["python_packages"]["librosa"] = True
    except ImportError:
        requirements["audio_libraries"] = False
        requirements["python_packages"]["librosa"] = False
    
    # Check disk space
    try:
        import shutil
        total, used, free = shutil.disk_usage(".")
        free_gb = free // (1024**3)
        requirements["disk_space"] = free_gb > 1  # At least 1GB free
        requirements["disk_space_gb"] = free_gb
    except Exception:
        requirements["disk_space"] = False
    
    return requirements

# Global debug helper instance (uses TRANSCRIPTAI_DATA_DIR when present)
debug_helper = DebugHelper()
