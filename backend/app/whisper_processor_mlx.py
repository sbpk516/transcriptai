"""
MLX-based Whisper integration for TranscriptAI on Apple Silicon.
Provides optimized speech-to-text using mlx-whisper framework.
"""
import base64
import importlib
import os
import time
import threading
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging

from .mlx_runtime import activate_mlx_site_packages

from .config import settings
from .debug_utils import debug_helper
from .audio_processor import audio_processor
from .logging_config import log_function_call, PerformanceMonitor

# Configure logger for this module
logger = logging.getLogger('transcriptai.whisper_processor_mlx')

mlx_whisper = None
_MLX_AVAILABLE = False


def _ensure_mlx_import(reason: str) -> bool:
    global mlx_whisper, _MLX_AVAILABLE

    if _MLX_AVAILABLE and mlx_whisper is not None:
        return True

    try:
        mlx_whisper = importlib.import_module("mlx_whisper")
        # Verify the import actually works by checking for a key attribute
        # This catches AttributeError issues like mlx.core.array not existing
        if hasattr(mlx_whisper, 'transcribe'):
            _MLX_AVAILABLE = True
            return True
        else:
            raise AttributeError("mlx_whisper module missing required 'transcribe' function")
    except (ImportError, AttributeError, ModuleNotFoundError) as initial_error:
        # Try activating MLX site packages and retry
        if activate_mlx_site_packages(reason=reason, log=logger):
            try:
                mlx_whisper = importlib.import_module("mlx_whisper")
                if hasattr(mlx_whisper, 'transcribe'):
                    _MLX_AVAILABLE = True
                    return True
                else:
                    raise AttributeError("mlx_whisper module missing required 'transcribe' function")
            except (ImportError, AttributeError, ModuleNotFoundError) as retry_error:
                logger.debug("MLX import failed after activation: %s", retry_error)
        else:
            logger.debug("MLX site-packages activation failed for reason=%s", reason)

        logger.debug("MLX import failed: %s (type: %s)", initial_error, type(initial_error).__name__)
        mlx_whisper = None
        _MLX_AVAILABLE = False
        return False
    except Exception as unexpected_error:
        # Catch any other unexpected errors during import
        logger.warning("Unexpected error during MLX import: %s (type: %s)", unexpected_error, type(unexpected_error).__name__)
        mlx_whisper = None
        _MLX_AVAILABLE = False
        return False


def is_mlx_available() -> bool:
    """Public helper to probe MLX availability without raising."""
    return _ensure_mlx_import("availability_probe")

def _transcription_enabled() -> bool:
    return os.getenv("TRANSCRIPTAI_ENABLE_TRANSCRIPTION", "0") == "1"

def _forced_language() -> Optional[str]:
    """Determine if we should force a language."""
    env_lang = (os.getenv("TRANSCRIPTAI_FORCE_LANGUAGE") or "").strip()
    if env_lang:
        return env_lang
    if os.getenv("TRANSCRIPTAI_MODE", "").lower() == "desktop":
        return "en"
    return None


class WhisperProcessorMLX:
    """
    MLX-optimized Whisper processor for Apple Silicon.
    Drop-in replacement for WhisperProcessor using mlx-whisper.
    """
    
    def __init__(self, model_name: str = "tiny"):
        """
        Initialize MLX Whisper processor.
        
        Args:
            model_name: Whisper model size (tiny, base, small, medium, large)
                       Note: MLX models are downloaded from HuggingFace
        """
        self.model_name = model_name
        self.model = None
        self.device = "mlx"  # MLX always uses unified memory (Apple Silicon)
        
        # Create transcripts directory
        self.transcripts_dir = Path(settings.upload_dir) / "transcripts"
        self.transcripts_dir.mkdir(exist_ok=True)

        # Lazy-load model on first use
        self._model_loaded = False
        self._loading_in_progress = False
        self._loading_started_ts: Optional[float] = None
        self._last_load_elapsed: Optional[float] = None
        self._last_loaded_at: Optional[str] = None
        self._last_load_error: Optional[str] = None
        self._load_lock = threading.Lock()

        if not _ensure_mlx_import("whisper_processor_mlx_init"):
            logger.warning("MLX/mlx-whisper not available. Instance cannot process audio.")
            raise RuntimeError("MLX runtime unavailable")
        
        if not _transcription_enabled():
            logger.warning("Transcription disabled via TRANSCRIPTAI_ENABLE_TRANSCRIPTION=0")
        if not _MLX_AVAILABLE:
            logger.warning("MLX/mlx-whisper not available. Transcription disabled.")
        
        logger.info(f"MLX Whisper processor initialized with model: {model_name} on {self.device}")
    
    def _load_model(self) -> bool:
        """
        Load MLX Whisper model.
        
        Returns:
            True if model loaded successfully, False otherwise
        """
        try:
            logger.info(f"Loading MLX Whisper model: {self.model_name}")

            with PerformanceMonitor("mlx_whisper_model_loading") as monitor:
                if not _MLX_AVAILABLE:
                    if not _ensure_mlx_import("model_load"):
                        raise RuntimeError("MLX/mlx-whisper not available")
                
                # MLX models are auto-downloaded from HuggingFace
                # Format: "mlx-community/whisper-{model_name}"
                model_id = f"mlx-community/whisper-{self.model_name}"
                
                logger.info(f"Loading MLX model from: {model_id}")
                
                # Load model using mlx_whisper
                # Note: mlx_whisper.load_model returns model weights, not a model object
                # The transcribe function handles loading internally
                self.model = model_id  # Store model ID for transcription
                
                logger.info(f"MLX Whisper model {self.model_name} loaded successfully on {self.device}")

                # Log model information
                debug_helper.log_debug_info(
                    "mlx_whisper_model_loaded",
                    {
                        "model_name": self.model_name,
                        "model_id": model_id,
                        "device": self.device,
                        "backend": "mlx",
                    }
                )

                self._model_loaded = True
                self._last_load_error = None
                return True

        except Exception as e:
            logger.error(f"Failed to load MLX Whisper model {self.model_name}: {e}")
            debug_helper.capture_exception(
                "mlx_whisper_model_loading",
                e,
                {"model_name": self.model_name, "device": self.device}
            )

            # Try fallback to tiny model
            if self.model_name != "tiny":
                logger.info(f"Trying fallback to tiny model...")
                self.model_name = "tiny"
                return self._load_model()
            else:
                logger.error("All model loading attempts failed")
                return False

    def ensure_loaded(self, timeout: Optional[float] = None, *, background: bool = False) -> bool:
        """Ensure the MLX Whisper model is loaded, loading it if necessary."""
        if self._model_loaded:
            return False

        acquired = False
        start_wait = time.perf_counter()
        try:
            if timeout is None:
                self._load_lock.acquire()
                acquired = True
            else:
                acquired = self._load_lock.acquire(timeout=timeout)
            if not acquired:
                waited = time.perf_counter() - start_wait
                self._last_load_error = f"timeout after {waited:.3f}s waiting for MLX Whisper model load lock"
                raise TimeoutError(self._last_load_error)

            if self._model_loaded:
                return False

            self._loading_in_progress = True
            self._loading_started_ts = time.perf_counter()
            logger.info(
                "[MLX WHISPER] model_load status=begin background=%s", background
            )
            success = self._load_model()
            elapsed = time.perf_counter() - (self._loading_started_ts or time.perf_counter())
            self._last_load_elapsed = elapsed
            if success:
                self._last_load_error = None
                self._last_loaded_at = datetime.now().isoformat()
                logger.info(
                    "[MLX WHISPER] model_load status=complete elapsed=%.3fs", elapsed
                )
            else:
                self._last_load_error = "MLX Whisper model failed to load"
                logger.error(
                    "[MLX WHISPER] model_load status=failed elapsed=%.3fs", elapsed
                )
                raise RuntimeError("MLX Whisper model failed to load")
            return success
        finally:
            self._loading_in_progress = False
            self._loading_started_ts = None
            if acquired:
                self._load_lock.release()

    def get_status(self) -> Dict[str, Any]:
        """Return current model status for diagnostics and health reporting."""
        if self._loading_in_progress:
            status = "loading"
        elif self._model_loaded:
            status = "ready"
        else:
            status = "not_loaded"

        return {
            "status": status,
            "loaded": self._model_loaded,
            "loading": self._loading_in_progress,
            "model_name": self.model_name,
            "device": self.device,
            "backend": "mlx",
            "last_load_elapsed": self._last_load_elapsed,
            "last_loaded_at": self._last_loaded_at,
            "last_error": self._last_load_error,
        }

    @log_function_call
    def transcribe_audio(
        self, 
        audio_path: str, 
        language: Optional[str] = None,
        task: str = "transcribe",
        verbose: bool = False
    ) -> Dict[str, Any]:
        """
        Transcribe audio file using MLX Whisper.
        
        Args:
            audio_path: Path to audio file
            language: Language code (e.g., 'en', 'es', 'fr') or None for auto-detection
            task: Task type ('transcribe' or 'translate')
            verbose: Enable verbose output
            
        Returns:
            Dictionary containing transcription results
        """
        logger.info(f"Starting MLX transcription: {audio_path}")
        
        if not _transcription_enabled():
            error_msg = "Transcription disabled (env flag)"
            logger.warning(error_msg)
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }

        try:
            self.ensure_loaded()
        except TimeoutError as exc:
            error_msg = f"MLX Whisper model load timed out: {exc}"
            logger.error(error_msg)
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }
        except Exception as exc:
            error_msg = f"MLX Whisper model load failed: {exc}"
            logger.error(error_msg)
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }

        with PerformanceMonitor("mlx_whisper_transcription") as monitor:
            try:
                # Verify audio file exists
                if not os.path.exists(audio_path):
                    raise FileNotFoundError(f"Audio file not found: {audio_path}")
                
                # Prepare transcription options for MLX
                options: Dict[str, Any] = {
                    "task": task,
                    "verbose": verbose,
                }

                # Apply language selection
                forced_lang = _forced_language()
                lang_to_use = language or forced_lang
                if lang_to_use:
                    options["language"] = lang_to_use
                    if language:
                        logger.info(f"Using specified language: {lang_to_use}")
                    else:
                        logger.info(f"Forcing language via policy: {lang_to_use}")
                else:
                    logger.info("Auto-detecting language")
                
                logger.debug(f"MLX Transcription options: {options}")
                
                # Perform transcription using mlx_whisper
                result = mlx_whisper.transcribe(
                    audio_path,
                    path_or_hf_repo=self.model,  # Model ID
                    **options
                )
                
                # Extract key information (mlx_whisper returns same format as openai-whisper)
                transcription_data = {
                    "audio_path": audio_path,
                    "transcription_success": True,
                    "text": result.get("text", "").strip(),
                    "language": result.get("language", "unknown"),
                    "segments": result.get("segments", []),
                    "transcription_timestamp": datetime.now().isoformat(),
                    "model_used": self.model_name,
                    "device_used": self.device,
                    "backend": "mlx",
                    "task": task
                }
                
                # Calculate additional metrics
                if transcription_data["text"]:
                    transcription_data["word_count"] = len(transcription_data["text"].split())
                    transcription_data["character_count"] = len(transcription_data["text"])
                    transcription_data["confidence_score"] = self._calculate_confidence(result.get("segments", []))
                
                logger.info(f"MLX Transcription completed successfully for {audio_path}")
                logger.info(f"Language detected: {transcription_data['language']}")
                logger.info(f"Text length: {transcription_data.get('word_count', 0)} words, {transcription_data.get('character_count', 0)} characters")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "mlx_whisper_transcription_success",
                    {
                        "audio_path": audio_path,
                        "language": transcription_data["language"],
                        "word_count": transcription_data.get("word_count", 0),
                        "confidence_score": transcription_data.get("confidence_score", 0.0),
                        "model_used": self.model_name,
                        "backend": "mlx"
                    }
                )
                
                return transcription_data
                
            except Exception as e:
                logger.error(f"MLX Transcription failed for {audio_path}: {e}")
                debug_helper.capture_exception(
                    "mlx_whisper_transcription",
                    e,
                    {"audio_path": audio_path, "language": language, "task": task}
                )
                
                return {
                    "audio_path": audio_path,
                    "transcription_success": False,
                    "error": str(e),
                    "transcription_timestamp": datetime.now().isoformat(),
                    "model_used": self.model_name,
                    "device_used": self.device,
                    "backend": "mlx"
                }

    def transcribe_snippet_from_base64(
        self,
        audio_base64: str,
        *,
        media_type: str = "audio/wav",
        sample_rate: Optional[int] = None,
        max_bytes: int = 5 * 1024 * 1024,
        max_duration_ms: int = 120 * 1000,
    ) -> Dict[str, Any]:
        """Decode a base64 snippet, normalize it, and run MLX Whisper transcription."""

        if not audio_base64 or not isinstance(audio_base64, str):
            raise ValueError("audio_base64 payload is required")

        if not _transcription_enabled():
            raise RuntimeError("Transcription disabled via environment flag")

        try:
            audio_bytes = base64.b64decode(audio_base64, validate=True)
        except Exception as exc:
            logger.warning("Invalid base64 audio payload: %s", exc)
            raise ValueError("audio_base64 payload is not valid base64") from exc

        if len(audio_bytes) == 0:
            raise ValueError("audio_base64 payload is empty")

        if len(audio_bytes) > max_bytes:
            raise ValueError("audio payload exceeds maximum allowed size")

        suffix_map = {
            "audio/wav": ".wav",
            "audio/x-wav": ".wav",
            "audio/mpeg": ".mp3",
            "audio/mp3": ".mp3",
            "audio/ogg": ".ogg",
            "audio/webm": ".webm",
        }
        normalized_media_type = media_type.lower()
        if normalized_media_type not in suffix_map:
            raise ValueError("unsupported media_type")
        suffix = suffix_map[normalized_media_type]

        logger.info(
            "[MLX DICTATION] snippet received size_bytes=%s media_type=%s",
            len(audio_bytes),
            media_type,
        )

        tmp_input = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp_input_path = tmp_input.name
        tmp_input.write(audio_bytes)
        tmp_input.close()

        converted_path: Optional[str] = None
        try:
            # Normalize to WAV/mono for whisper for consistent results
            try:
                convert_result = audio_processor.convert_audio_format(
                    tmp_input_path,
                    output_format="wav",
                    sample_rate=sample_rate or 16000,
                    channels=1,
                )
                if not convert_result.get("conversion_success"):
                    raise RuntimeError(convert_result.get("error") or "conversion failed")
                converted_path = convert_result.get("output_path")
            except Exception as exc:
                logger.error("Audio normalization failed: %s", exc)
                raise RuntimeError("Unable to normalize audio snippet") from exc

            analysis = audio_processor.analyze_audio_file(converted_path)
            if not analysis.get("analysis_success"):
                raise RuntimeError("Unable to analyze audio snippet")

            duration_sec = float(analysis.get("duration_seconds", 0.0))
            duration_ms = int(duration_sec * 1000)

            if max_duration_ms and duration_ms > max_duration_ms:
                raise ValueError("audio snippet duration exceeds limit")

            transcription = self.transcribe_audio(converted_path)
            if not transcription.get("transcription_success"):
                raise RuntimeError(transcription.get("error") or "transcription failed")

            text = transcription.get("text", "").strip()
            confidence = float(transcription.get("confidence_score", 0.0))

            logger.info(
                "[MLX DICTATION] snippet transcription complete duration_ms=%s text_len=%s",
                duration_ms,
                len(text),
            )

            return {
                "text": text,
                "confidence": confidence,
                "duration_ms": duration_ms,
            }

        finally:
            try:
                os.unlink(tmp_input_path)
            except Exception:
                pass
            if converted_path and os.path.exists(converted_path):
                try:
                    os.unlink(converted_path)
                except Exception:
                    pass
    
    def _calculate_confidence(self, segments: List[Dict[str, Any]]) -> float:
        """
        Calculate overall confidence score from segments.
        
        Args:
            segments: List of transcription segments
            
        Returns:
            Average confidence score (0.0 to 1.0)
        """
        if not segments:
            return 0.0
        
        total_confidence = 0.0
        valid_segments = 0
        
        for segment in segments:
            if "avg_logprob" in segment:
                # Convert log probability to confidence (0-1 scale)
                confidence = max(0.0, min(1.0, (segment["avg_logprob"] + 1.0) / 2.0))
                total_confidence += confidence
                valid_segments += 1
        
        return total_confidence / valid_segments if valid_segments > 0 else 0.0

    @log_function_call
    def save_transcript(
        self,
        call_id: str,
        transcription_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Save transcription results to file.
        
        Args:
            transcription_data: Transcription results from MLX Whisper
            call_id: Unique call identifier
            
        Returns:
            Dictionary with save operation results
        """
        logger.info(f"Saving MLX transcript for call: {call_id}")
        
        try:
            # Create organized directory structure
            today = datetime.now()
            year_month_day = today.strftime("%Y/%m/%d")
            organized_dir = self.transcripts_dir / year_month_day
            organized_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate transcript filename
            transcript_filename = f"{call_id}_transcript.json"
            transcript_path = organized_dir / transcript_filename
            
            # Prepare transcript data for saving
            import json
            transcript_data = {
                "call_id": call_id,
                "transcription": transcription_data,
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "model_used": transcription_data.get("model_used", "unknown"),
                    "device_used": transcription_data.get("device_used", "mlx"),
                    "backend": "mlx",
                    "file_path": str(transcript_path)
                }
            }
            
            # Save to JSON file
            with open(transcript_path, 'w', encoding='utf-8') as f:
                json.dump(transcript_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"MLX Transcript saved to: {transcript_path}")
            
            # Log debug information
            debug_helper.log_debug_info(
                "mlx_transcript_saved",
                {
                    "call_id": call_id,
                    "transcript_path": str(transcript_path),
                    "file_size_bytes": transcript_path.stat().st_size,
                    "word_count": transcription_data.get("word_count", 0),
                    "backend": "mlx"
                }
            )
            
            return {
                "call_id": call_id,
                "save_success": True,
                "transcript_path": str(transcript_path),
                "file_size_bytes": transcript_path.stat().st_size,
                "save_timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to save MLX transcript for call {call_id}: {e}")
            debug_helper.capture_exception(
                "mlx_transcript_save",
                e,
                {"call_id": call_id}
            )
            
            return {
                "call_id": call_id,
                "save_success": False,
                "error": str(e),
                "save_timestamp": datetime.now().isoformat()
            }
    
    @log_function_call
    def get_available_models(self) -> List[str]:
        """
        Get list of available MLX Whisper models.
        
        Returns:
            List of available model names
        """
        # MLX community provides these models on HuggingFace
        return ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"]
    
    @log_function_call
    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the currently loaded MLX model.
        
        Returns:
            Dictionary with model information
        """
        if not self.model:
            return {
                "model_loaded": False,
                "error": "No model loaded"
            }
        
        return {
            "model_loaded": True,
            "model_name": self.model_name,
            "model_id": self.model,
            "device": self.device,
            "backend": "mlx",
            "platform": "Apple Silicon",
            "unified_memory": True,
        }

    def is_model_cached(self, model_name: str) -> bool:
        """
        Check if a model is already cached locally.
        
        Args:
            model_name: Name of the model (tiny, base, etc.)
            
        Returns:
            True if cached, False otherwise
        """
        try:
            from huggingface_hub import try_to_load_from_cache
            repo_id = f"mlx-community/whisper-{model_name}"
            # Check for a key file like 'config.json'
            filepath = try_to_load_from_cache(repo_id=repo_id, filename="config.json")
            return filepath is not None and os.path.exists(filepath)
        except Exception as e:
            logger.warning(f"Failed to check cache for {model_name}: {e}")
            return False

    def download_model(self, model_name: str) -> bool:
        """
        Explicitly download a model to the cache.
        
        Args:
            model_name: Name of the model to download
            
        Returns:
            True if successful
        """
        try:
            logger.info(f"Starting explicit download for {model_name}")
            if not _ensure_mlx_import("download_model"):
                 raise RuntimeError("MLX not available")
                 
            # Trigger download by loading it (mlx_whisper handles the download)
            # We don't set self.model yet, just ensure it's in cache
            repo_id = f"mlx-community/whisper-{model_name}"
            
            # Use snapshot_download from huggingface_hub directly if possible for better control
            # But mlx_whisper.load_model is the standard way.
            # Since mlx_whisper.load_model returns weights, we can just call it and discard result.
            # However, to avoid loading into RAM, let's use huggingface_hub directly.
            from huggingface_hub import snapshot_download
            snapshot_download(repo_id=repo_id)
            
            logger.info(f"Download complete for {model_name}")
            return True
        except Exception as e:
            logger.error(f"Download failed for {model_name}: {e}")
            return False

    def reload_model(self, model_name: str) -> bool:
        """
        Switch the active model.
        
        Args:
            model_name: Name of the new model to load
            
        Returns:
            True if successful
        """
        logger.info(f"Switching model from {self.model_name} to {model_name}")
        
        # Acquire lock to prevent transcription during switch
        with self._load_lock:
            try:
                self.model_name = model_name
                self._model_loaded = False
                self.model = None
                
                # Load the new model
                success = self._load_model()
                if success:
                    logger.info(f"Successfully switched to {model_name}")
                else:
                    logger.error(f"Failed to switch to {model_name}")
                return success
            except Exception as e:
                logger.error(f"Error switching model: {e}")
                return False

