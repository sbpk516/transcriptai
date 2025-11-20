"""
Audio processing module for SignalHub Phase 1.2.
Provides comprehensive audio analysis and processing using FFmpeg.
"""
import os
import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

from .config import settings
from .debug_utils import debug_helper
from .logging_config import log_function_call, PerformanceMonitor

# Configure logger for this module
logger = logging.getLogger('signalhub.audio_processor')

class AudioProcessor:
    """
    Handles audio file processing with FFmpeg integration.
    Provides comprehensive audio analysis and format conversion.
    """
    
    def __init__(self):
        self.upload_dir = Path(settings.upload_dir)
        self.processed_dir = self.upload_dir / "processed"
        self.processed_dir.mkdir(exist_ok=True)
        
        # Verify FFmpeg is available
        self._verify_ffmpeg()
        
        logger.info("Audio processor initialized successfully")
    
    def _verify_ffmpeg(self) -> bool:
        """
        Verify that FFmpeg is installed and accessible.
        
        Returns:
            True if FFmpeg is available, False otherwise
        """
        try:
            result = subprocess.run(
                ['ffmpeg', '-version'], 
                capture_output=True, 
                text=True, 
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info("FFmpeg is available and working")
                debug_helper.log_debug_info(
                    "ffmpeg_verification",
                    {"status": "success", "version": result.stdout.split('\n')[0]}
                )
                return True
            else:
                logger.error(f"FFmpeg verification failed: {result.stderr}")
                return False
                
        except FileNotFoundError:
            logger.error("FFmpeg not found in system PATH")
            debug_helper.log_debug_info(
                "ffmpeg_verification",
                {"status": "not_found", "error": "FFmpeg not in PATH"}
            )
            return False
        except subprocess.TimeoutExpired:
            logger.error("FFmpeg verification timed out")
            return False
        except Exception as e:
            logger.error(f"FFmpeg verification error: {e}")
            return False
    
    @log_function_call
    def analyze_audio_file(self, file_path: str) -> Dict[str, Any]:
        """
        Analyze audio file using FFmpeg to extract detailed information.
        
        Args:
            file_path: Path to the audio file
            
        Returns:
            Dictionary containing audio analysis results
        """
        logger.info(f"Starting audio analysis for: {file_path}")
        
        with PerformanceMonitor("audio_analysis") as monitor:
            try:
                # Use ffmpeg-python for analysis
                import ffmpeg
                
                # Get detailed audio information
                probe = ffmpeg.probe(file_path)
                
                # Extract format information
                format_info = probe.get('format', {})
                
                # Find audio stream
                audio_stream = None
                for stream in probe.get('streams', []):
                    if stream.get('codec_type') == 'audio':
                        audio_stream = stream
                        break
                
                if not audio_stream:
                    raise ValueError("No audio stream found in file")
                
                # Extract key audio properties
                analysis_result = {
                    "file_path": file_path,
                    "file_size_bytes": int(format_info.get('size', 0)),
                    "duration_seconds": float(format_info.get('duration', 0)),
                    "format": format_info.get('format_name', 'unknown'),
                    "bit_rate": int(format_info.get('bit_rate', 0)),
                    "audio_codec": audio_stream.get('codec_name', 'unknown'),
                    "sample_rate": int(audio_stream.get('sample_rate', 0)),
                    "channels": int(audio_stream.get('channels', 0)),
                    "channel_layout": audio_stream.get('channel_layout', 'unknown'),
                    "analysis_timestamp": datetime.now().isoformat(),
                    "analysis_success": True
                }
                
                logger.info(f"Audio analysis completed successfully for {file_path}")
                logger.debug(f"Analysis result: {json.dumps(analysis_result, indent=2)}")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "audio_analysis_success",
                    {
                        "file_path": file_path,
                        "duration": analysis_result["duration_seconds"],
                        "format": analysis_result["format"],
                        "sample_rate": analysis_result["sample_rate"]
                    }
                )
                
                return analysis_result
                
            except ImportError:
                logger.error("ffmpeg-python not installed")
                debug_helper.capture_exception(
                    "audio_analysis",
                    ImportError("ffmpeg-python not installed"),
                    {"file_path": file_path}
                )
                return self._fallback_analysis(file_path)
                
            except Exception as e:
                logger.error(f"Audio analysis failed for {file_path}: {e}")
                debug_helper.capture_exception(
                    "audio_analysis",
                    e,
                    {"file_path": file_path}
                )
                return {
                    "file_path": file_path,
                    "analysis_success": False,
                    "error": str(e),
                    "analysis_timestamp": datetime.now().isoformat()
                }
    
    def _fallback_analysis(self, file_path: str) -> Dict[str, Any]:
        """
        Fallback analysis using subprocess when ffmpeg-python is not available.
        
        Args:
            file_path: Path to the audio file
            
        Returns:
            Basic audio information
        """
        logger.info(f"Using fallback analysis for: {file_path}")
        
        try:
            # Use ffprobe directly
            result = subprocess.run(
                [
                    'ffprobe', 
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_format',
                    '-show_streams',
                    file_path
                ],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                probe_data = json.loads(result.stdout)
                
                # Extract basic information
                format_info = probe_data.get('format', {})
                audio_stream = None
                
                for stream in probe_data.get('streams', []):
                    if stream.get('codec_type') == 'audio':
                        audio_stream = stream
                        break
                
                if audio_stream:
                    return {
                        "file_path": file_path,
                        "file_size_bytes": int(format_info.get('size', 0)),
                        "duration_seconds": float(format_info.get('duration', 0)),
                        "format": format_info.get('format_name', 'unknown'),
                        "audio_codec": audio_stream.get('codec_name', 'unknown'),
                        "sample_rate": int(audio_stream.get('sample_rate', 0)),
                        "channels": int(audio_stream.get('channels', 0)),
                        "analysis_timestamp": datetime.now().isoformat(),
                        "analysis_success": True,
                        "analysis_method": "fallback_subprocess"
                    }
                else:
                    raise ValueError("No audio stream found")
            else:
                raise subprocess.CalledProcessError(
                    result.returncode, 
                    'ffprobe', 
                    result.stderr
                )
                
        except Exception as e:
            logger.error(f"Fallback analysis failed: {e}")
            return {
                "file_path": file_path,
                "analysis_success": False,
                "error": str(e),
                "analysis_timestamp": datetime.now().isoformat(),
                "analysis_method": "fallback_failed"
            }
    
    @log_function_call
    def convert_audio_format(
        self, 
        input_path: str, 
        output_format: str = "wav",
        sample_rate: int = 16000,
        channels: int = 1
    ) -> Dict[str, Any]:
        """
        Convert audio file to specified format using FFmpeg.
        
        Args:
            input_path: Path to input audio file
            output_format: Desired output format (wav, mp3, etc.)
            sample_rate: Target sample rate in Hz
            channels: Number of channels (1=mono, 2=stereo)
            
        Returns:
            Dictionary with conversion results
        """
        logger.info(f"Converting audio: {input_path} to {output_format}")
        
        with PerformanceMonitor("audio_conversion") as monitor:
            try:
                # Generate output path
                input_path_obj = Path(input_path)
                output_filename = f"{input_path_obj.stem}_converted.{output_format}"
                output_path = self.processed_dir / output_filename
                
                # Build FFmpeg command
                cmd = [
                    'ffmpeg',
                    '-i', input_path,
                    '-ar', str(sample_rate),  # Sample rate
                    '-ac', str(channels),     # Number of channels
                    '-y',  # Overwrite output file
                    str(output_path)
                ]
                
                logger.debug(f"FFmpeg command: {' '.join(cmd)}")
                
                # Execute conversion
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300  # 5 minutes timeout
                )
                
                if result.returncode == 0:
                    # Verify output file exists and has content
                    if output_path.exists() and output_path.stat().st_size > 0:
                        conversion_result = {
                            "input_path": input_path,
                            "output_path": str(output_path),
                            "output_format": output_format,
                            "sample_rate": sample_rate,
                            "channels": channels,
                            "conversion_success": True,
                            "output_size_bytes": output_path.stat().st_size,
                            "conversion_timestamp": datetime.now().isoformat()
                        }
                        
                        logger.info(f"Audio conversion successful: {output_path}")
                        debug_helper.log_debug_info(
                            "audio_conversion_success",
                            {
                                "input_path": input_path,
                                "output_path": str(output_path),
                                "output_size": conversion_result["output_size_bytes"]
                            }
                        )
                        
                        return conversion_result
                    else:
                        raise ValueError("Output file is empty or missing")
                else:
                    stderr = result.stderr.strip()
                    logger.error(
                        "FFmpeg conversion failed",
                        extra={
                            "input_path": input_path,
                            "output_path": str(output_path),
                            "returncode": result.returncode,
                            "stderr": stderr,
                        }
                    )
                    raise subprocess.CalledProcessError(
                        result.returncode,
                        'ffmpeg',
                        stderr
                    )
                    
            except subprocess.TimeoutExpired:
                error_msg = "Audio conversion timed out"
                logger.error(error_msg)
                debug_helper.capture_exception(
                    "audio_conversion",
                    Exception(error_msg),
                    {"input_path": input_path, "output_format": output_format}
                )
                return {
                    "input_path": input_path,
                    "conversion_success": False,
                    "error": error_msg,
                    "conversion_timestamp": datetime.now().isoformat()
                }
                
            except Exception as e:
                err_extra = {}
                if isinstance(e, subprocess.CalledProcessError):
                    err_extra = {
                        "cmd": e.cmd,
                        "returncode": e.returncode,
                        "stderr": getattr(e, "stderr", ""),
                    }
                logger.error(f"Audio conversion failed: {e}", extra=err_extra)
                debug_helper.capture_exception(
                    "audio_conversion",
                    e,
                    {"input_path": input_path, "output_format": output_format}
                )
                return {
                    "input_path": input_path,
                    "conversion_success": False,
                    "error": str(e),
                    "conversion_timestamp": datetime.now().isoformat()
                }
    
    @log_function_call
    def extract_audio_segment(
        self, 
        file_path: str, 
        start_time: float, 
        duration: float,
        output_format: str = "wav"
    ) -> Dict[str, Any]:
        """
        Extract a segment from an audio file.
        
        Args:
            file_path: Path to input audio file
            start_time: Start time in seconds
            duration: Duration to extract in seconds
            output_format: Output format
            
        Returns:
            Dictionary with extraction results
        """
        logger.info(f"Extracting audio segment: {file_path} from {start_time}s for {duration}s")
        
        try:
            # Generate output path
            input_path_obj = Path(file_path)
            output_filename = f"{input_path_obj.stem}_segment_{start_time}_{duration}.{output_format}"
            output_path = self.processed_dir / output_filename
            
            # Build FFmpeg command for segment extraction
            cmd = [
                'ffmpeg',
                '-i', file_path,
                '-ss', str(start_time),  # Start time
                '-t', str(duration),     # Duration
                '-y',  # Overwrite output file
                str(output_path)
            ]
            
            logger.debug(f"FFmpeg segment command: {' '.join(cmd)}")
            
            # Execute extraction
            # Timeout increased to 10 minutes to support large chunk extraction (60-minute chunks)
            # For 60-minute audio chunks, FFmpeg needs more time to process
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600  # 10 minutes for large chunk extraction
            )
            
            if result.returncode == 0 and output_path.exists():
                return {
                    "input_path": file_path,
                    "output_path": str(output_path),
                    "start_time": start_time,
                    "duration": duration,
                    "extraction_success": True,
                    "output_size_bytes": output_path.stat().st_size,
                    "extraction_timestamp": datetime.now().isoformat()
                }
            else:
                raise subprocess.CalledProcessError(
                    result.returncode, 
                    'ffmpeg', 
                    result.stderr
                )
                
        except Exception as e:
            logger.error(f"Audio segment extraction failed: {e}")
            debug_helper.capture_exception(
                "audio_segment_extraction",
                e,
                {"file_path": file_path, "start_time": start_time, "duration": duration}
            )
            return {
                "input_path": file_path,
                "extraction_success": False,
                "error": str(e),
                "extraction_timestamp": datetime.now().isoformat()
            }

# Global audio processor instance
audio_processor = AudioProcessor()
