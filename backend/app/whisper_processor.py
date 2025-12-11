"""
Whisper integration module for TranscriptAI Phase 1.2.2.
Provides comprehensive speech-to-text functionality using OpenAI Whisper.
"""
import base64
import os
import json
import os
import time
import threading
import tempfile
_MODULE_IMPORT_STARTED = time.perf_counter()
_MODULE_IMPORT_ENDED = None

try:
    import whisper  # type: ignore
    import torch  # type: ignore
    _WHISPER_AVAILABLE = True
except Exception as _e:  # Whisper/Torch optional
    # Log the actual error for debugging (especially important in packaged apps)
    import logging
    _logger = logging.getLogger('transcriptai.whisper_processor')
    _logger.warning(f"Failed to import Whisper/Torch: {_e}", exc_info=True)
    whisper = None  # type: ignore
    torch = None  # type: ignore
    _WHISPER_AVAILABLE = False
from pathlib import Path
from typing import Dict, Any, Optional, List, Generator
from datetime import datetime
import logging

from .config import settings
from .debug_utils import debug_helper
from .audio_processor import audio_processor
from .logging_config import log_function_call, PerformanceMonitor

# Initialize startup logger for timing logs
startup_logger = logging.getLogger("transcriptai.startup")
if not startup_logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(message)s'))
    startup_logger.addHandler(handler)
    startup_logger.setLevel(logging.INFO)
    startup_logger.propagate = False

# Configure logger for this module
logger = logging.getLogger('transcriptai.whisper_processor')
_MODULE_IMPORT_ENDED = time.perf_counter()


def _whisper_cache_root() -> Path:
    """
    Resolve the cache directory used by whisper for storing model checkpoints.

    Mirror whisper.load_model behaviour: default to $XDG_CACHE_HOME/whisper or
    ~/.cache/whisper when the XDG path is not provided.
    """
    default_cache = Path(os.path.expanduser("~")) / ".cache"
    base = Path(os.getenv("XDG_CACHE_HOME", str(default_cache)))
    return base / "whisper"

def _transcription_enabled() -> bool:
    """Check if transcription is enabled. Defaults to enabled (1) for normal operation."""
    enabled = os.getenv("TRANSCRIPTAI_ENABLE_TRANSCRIPTION", "1") == "1"
    if not enabled:
        logger.warning("[TRANSCRIPTION] Transcription is DISABLED via TRANSCRIPTAI_ENABLE_TRANSCRIPTION=0")
    else:
        logger.debug("[TRANSCRIPTION] Transcription is ENABLED")
    return enabled


def _forced_language() -> Optional[str]:
    """Determine if we should force a language.

    Returns a language code (e.g., 'en') if forcing is enabled, otherwise None.
    Policy:
    - If TRANSCRIPTAI_FORCE_LANGUAGE is set (e.g., 'en'), use it.
    - Else, when running in desktop mode, default to 'en' to improve
      reliability for short/clean English clips without network.
    """
    env_lang = (os.getenv("TRANSCRIPTAI_FORCE_LANGUAGE") or "").strip()
    if env_lang:
        return env_lang
    if os.getenv("TRANSCRIPTAI_MODE", "").lower() == "desktop":
        return "en"
    return None


class WhisperProcessor:
    """
    Handles speech-to-text processing using OpenAI Whisper.
    Provides comprehensive transcription with multiple model options.
    """
    
    def __init__(self, model_name: str = "base"):
        """
        Initialize Whisper processor with specified model.
        
        Args:
            model_name: Whisper model size (tiny, base, small, medium, large)
        """
        self.model_name = model_name
        self.model = None
        self.device = "cpu"
        if _WHISPER_AVAILABLE:
            try:
                # Priority: Apple Silicon MPS > NVIDIA CUDA > CPU
                if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                    self.device = "mps"  # Apple Silicon GPU acceleration
                elif torch.cuda.is_available():
                    self.device = "cuda"  # NVIDIA GPU acceleration
                else:
                    self.device = "cpu"
            except Exception as e:
                logger.warning(f"⚠️  [MPS DIAGNOSTIC] Exception during device detection: {e}")
                self.device = "cpu"
            
            # Diagnostic logging for MPS availability
            logger.info(f"🔍 [MPS DIAGNOSTIC] torch.backends.mps exists: {hasattr(torch.backends, 'mps')}")
            if hasattr(torch.backends, 'mps'):
                try:
                    logger.info(f"🔍 [MPS DIAGNOSTIC] torch.backends.mps.is_available(): {torch.backends.mps.is_available()}")
                except Exception as e:
                    logger.warning(f"⚠️  [MPS DIAGNOSTIC] Error checking MPS availability: {e}")
            logger.info(f"🔍 [MPS DIAGNOSTIC] torch.__version__: {torch.__version__}")
            logger.info(f"🔍 [MPS DIAGNOSTIC] Selected device: {self.device}")

        # Create transcripts directory
        self.transcripts_dir = Path(settings.upload_dir) / "transcripts"
        self.transcripts_dir.mkdir(exist_ok=True)

        # Lazy-load model on first use; warn if disabled or libs missing
        self._model_loaded = False
        self._loading_in_progress = False
        self._loading_started_ts: Optional[float] = None
        self._last_load_elapsed: Optional[float] = None
        self._last_loaded_at: Optional[str] = None
        self._last_load_error: Optional[str] = None
        self._load_lock = threading.Lock()
        if not _transcription_enabled():
            logger.warning("Transcription disabled via TRANSCRIPTAI_ENABLE_TRANSCRIPTION=0")
        if not _WHISPER_AVAILABLE:
            logger.warning("Whisper/Torch not available. Transcription disabled.")
        
        logger.info(f"Whisper processor initialized with model: {model_name} on {self.device}")
    
    def _load_model(self) -> bool:
        """
        Load Whisper model with error handling and fallback options.

        Returns:
            True if model loaded successfully, False otherwise
        """
        _load_start = time.perf_counter()
        _load_timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        startup_logger.info("[WHISPER] phase=model_load_start timestamp=%s model_name=%s", _load_timestamp, self.model_name)
        try:
            logger.info(f"Loading Whisper model: {self.model_name}")

            with PerformanceMonitor("whisper_model_loading") as monitor:
                # Load model with device specification
                if not _WHISPER_AVAILABLE:
                    raise RuntimeError("Whisper/Torch not available")
                
                # Use bundled model cache if available (for packaged apps)
                import os
                _cache_check_start = time.perf_counter()
                cache_dir = os.environ.get('XDG_CACHE_HOME')
                if cache_dir:
                    download_root = os.path.join(cache_dir, 'whisper')
                    logger.info(f"🔍 [CACHE] Using Whisper cache: {download_root}")
                    # Verify cache directory exists
                    if os.path.exists(download_root):
                        try:
                            cache_contents = os.listdir(download_root)
                            logger.info(f"✅ [CACHE] Cache directory exists with {len(cache_contents)} items: {cache_contents}")
                        except Exception as e:
                            logger.warning(f"⚠️  [CACHE] Could not list cache contents: {e}")
                    else:
                        logger.warning(f"⚠️  [CACHE] Cache directory not found: {download_root}")
                else:
                    logger.warning("⚠️  [CACHE] XDG_CACHE_HOME not set, using default Whisper cache (will download if needed)")
                _cache_check_elapsed = (time.perf_counter() - _cache_check_start) * 1000
                startup_logger.info("[WHISPER] phase=cache_check elapsed=%.3fms", _cache_check_elapsed)
                
                _model_load_start = time.perf_counter()
                if cache_dir:
                    self.model = whisper.load_model(
                        self.model_name, 
                        device=self.device,
                        download_root=download_root
                    )
                else:
                    self.model = whisper.load_model(self.model_name, device=self.device)
                _model_load_elapsed = (time.perf_counter() - _model_load_start) * 1000
                startup_logger.info("[WHISPER] phase=model_file_load elapsed=%.3fms", _model_load_elapsed)

                logger.info(f"Whisper model {self.model_name} loaded successfully on {self.device}")

                _model_info_start = time.perf_counter()
                # Log model information
                debug_helper.log_debug_info(
                    "whisper_model_loaded",
                    {
                        "model_name": self.model_name,
                        "device": self.device,
                        "model_parameters": sum(p.numel() for p in self.model.parameters()),
                        "model_size_mb": sum(p.numel() * p.element_size() for p in self.model.parameters()) / (1024 * 1024)
                    }
                )
                _model_info_elapsed = (time.perf_counter() - _model_info_start) * 1000
                startup_logger.info("[WHISPER] phase=model_info_log elapsed=%.3fms", _model_info_elapsed)

                self._model_loaded = True
                self._last_load_error = None
                _load_total_elapsed = (time.perf_counter() - _load_start) * 1000
                startup_logger.info("[WHISPER] phase=model_load_complete elapsed=%.3fms", _load_total_elapsed)
                return True

        except Exception as e:
            _load_error_elapsed = (time.perf_counter() - _load_start) * 1000
            startup_logger.error("[WHISPER] phase=model_load_error elapsed=%.3fms error=%s", _load_error_elapsed, str(e))
            logger.error(f"Failed to load Whisper model {self.model_name}: {e}")
            debug_helper.capture_exception(
                "whisper_model_loading",
                e,
                {"model_name": self.model_name, "device": self.device}
            )

            # Try fallback to smaller model
            if self.model_name != "tiny":
                logger.info(f"Trying fallback to tiny model...")
                self.model_name = "tiny"
                return self._load_model()
            else:
                logger.error("All model loading attempts failed")
                return False

    def ensure_loaded(self, timeout: Optional[float] = None, *, background: bool = False) -> bool:
        """Ensure the Whisper model is loaded, loading it if necessary."""
        if self._model_loaded:
            return False

        _ensure_start = time.perf_counter()
        _ensure_timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        startup_logger.info("[WHISPER] phase=ensure_loaded_start timestamp=%s background=%s", _ensure_timestamp, background)
        
        acquired = False
        start_wait = time.perf_counter()
        try:
            if timeout is None:
                self._load_lock.acquire()
                acquired = True
            else:
                acquired = self._load_lock.acquire(timeout=timeout)
            lock_wait_elapsed = time.perf_counter() - start_wait
            startup_logger.info("[WHISPER] phase=lock_acquired elapsed=%.3fms", lock_wait_elapsed * 1000)
            if not acquired:
                waited = time.perf_counter() - start_wait
                self._last_load_error = f"timeout after {waited:.3f}s waiting for Whisper model load lock"
                startup_logger.error("[WHISPER] phase=lock_timeout elapsed=%.3fms", waited * 1000)
                raise TimeoutError(self._last_load_error)

            if self._model_loaded:
                startup_logger.info("[WHISPER] phase=ensure_loaded_skip already_loaded=1")
                return False

            self._loading_in_progress = True
            self._loading_started_ts = time.perf_counter()
            logger.info(
                "[WHISPER] model_load status=begin background=%s", background
            )
            success = self._load_model()
            elapsed = time.perf_counter() - (self._loading_started_ts or time.perf_counter())
            self._last_load_elapsed = elapsed
            if success:
                self._last_load_error = None
                self._last_loaded_at = datetime.now().isoformat()
                logger.info(
                    "[WHISPER] model_load status=complete elapsed=%.3fs", elapsed
                )
                _ensure_total_elapsed = (time.perf_counter() - _ensure_start) * 1000
                startup_logger.info("[WHISPER] phase=ensure_loaded_complete elapsed=%.3fms", _ensure_total_elapsed)
            else:
                self._last_load_error = "Whisper model failed to load"
                logger.error(
                    "[WHISPER] model_load status=failed elapsed=%.3fs", elapsed
                )
                _ensure_total_elapsed = (time.perf_counter() - _ensure_start) * 1000
                startup_logger.error("[WHISPER] phase=ensure_loaded_failed elapsed=%.3fms", _ensure_total_elapsed)
                raise RuntimeError("Whisper model failed to load")
            return success
        finally:
            self._loading_in_progress = False
            self._loading_started_ts = None
            if acquired:
                self._load_lock.release()

    def get_status(self) -> Dict[str, Any]:
        """
        Return current model status for diagnostics and health reporting.
        
        IMPORTANT: Returns "ready" if processor is initialized, even if model weights
        aren't loaded yet. Model loads lazily on first transcription request.
        This allows frontend to show "ready" status and enable transcription immediately.
        """
        if self._loading_in_progress:
            status = "loading"
        elif self._model_loaded:
            status = "ready"
        else:
            # Processor is initialized and ready to transcribe
            # Model will load automatically on first transcription request
            status = "ready"

        return {
            "status": status,
            "loaded": self._model_loaded,
            "loading": self._loading_in_progress,
            "model_name": self.model_name,
            "device": self.device,
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
        Transcribe audio file using Whisper.
        
        Args:
            audio_path: Path to audio file
            language: Language code (e.g., 'en', 'es', 'fr') or None for auto-detection
            task: Task type ('transcribe' or 'translate')
            verbose: Enable verbose output
            
        Returns:
            Dictionary containing transcription results
        """
        logger.info(f"[TRANSCRIPTION] Starting transcription: {audio_path}")
        transcription_start_time = time.perf_counter()
        
        # Check if transcription is enabled
        if not _transcription_enabled():
            error_msg = "Transcription disabled (env flag)"
            logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
            logger.error(f"[TRANSCRIPTION] Check TRANSCRIPTAI_ENABLE_TRANSCRIPTION environment variable")
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }
        logger.debug(f"[TRANSCRIPTION] Transcription enabled check passed")

        # Ensure model is loaded
        logger.debug(f"[TRANSCRIPTION] Ensuring model is loaded (model_name={self.model_name}, device={self.device})")
        try:
            model_loaded = self.ensure_loaded()
            if model_loaded:
                logger.debug(f"[TRANSCRIPTION] Model already loaded")
            else:
                logger.info(f"[TRANSCRIPTION] Model loaded successfully")
        except TimeoutError as exc:
            error_msg = f"Whisper model load timed out: {exc}"
            logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
            logger.error(f"[TRANSCRIPTION] Model loading timed out after waiting")
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }
        except Exception as exc:
            error_msg = f"Whisper model load failed: {exc}"
            logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
            logger.error(f"[TRANSCRIPTION] Exception during model load: {type(exc).__name__}: {exc}")
            import traceback
            logger.debug(f"[TRANSCRIPTION] Model load traceback:\n{traceback.format_exc()}")
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }

        with PerformanceMonitor("whisper_transcription") as monitor:
            try:
                # Verify audio file exists
                logger.debug(f"[TRANSCRIPTION] Checking if audio file exists: {audio_path}")
                if not os.path.exists(audio_path):
                    error_msg = f"Audio file not found: {audio_path}"
                    logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
                    raise FileNotFoundError(error_msg)
                
                # Check file size
                file_size = os.path.getsize(audio_path)
                logger.info(f"[TRANSCRIPTION] Audio file found: {audio_path} (size: {file_size} bytes)")
                
                # Prepare transcription options
                # Build options with conservative settings for short clips
                # and offline packaging scenarios.
                options: Dict[str, Any] = {
                    "task": task,
                    "verbose": verbose,
                    "fp16": self.device in ["cuda", "mps"],  # Enable fp16 for GPU acceleration
                    # Use standard temperature fallback to allow breaking out of loops
                    "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
                    "condition_on_previous_text": False,
                    # Standard settings to reject silence and repeating loops
                    "no_speech_threshold": 0.6,
                    "compression_ratio_threshold": 2.4,
                    "logprob_threshold": -1.0,
                }

                # Apply language selection: prefer explicit arg, else forced policy
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
                
                logger.debug(f"[TRANSCRIPTION] Transcription options: {options}")
                logger.info(f"[TRANSCRIPTION] Starting Whisper model transcription (model={self.model_name}, device={self.device})")
                
                # Perform transcription
                transcribe_start = time.perf_counter()
                result = self.model.transcribe(audio_path, **options)
                transcribe_elapsed = time.perf_counter() - transcribe_start
                logger.info(f"[TRANSCRIPTION] Whisper model transcription completed in {transcribe_elapsed:.2f}s")
                
                # Extract key information
                logger.debug(f"[TRANSCRIPTION] Extracting transcription data from result")
                extracted_text = result.get("text", "").strip()
                extracted_language = result.get("language", "unknown")
                extracted_segments = result.get("segments", [])
                
                logger.info(f"[TRANSCRIPTION] Extracted text length: {len(extracted_text)} characters")
                logger.info(f"[TRANSCRIPTION] Extracted language: {extracted_language}")
                logger.info(f"[TRANSCRIPTION] Number of segments: {len(extracted_segments)}")
                
                if not extracted_text:
                    logger.warning(f"[TRANSCRIPTION] WARNING: Extracted text is EMPTY!")
                    logger.warning(f"[TRANSCRIPTION] This may indicate silence was detected or transcription failed")
                    logger.debug(f"[TRANSCRIPTION] Result keys: {list(result.keys())}")
                    logger.debug(f"[TRANSCRIPTION] Segments: {extracted_segments[:3] if extracted_segments else 'None'}")
                
                transcription_data = {
                    "audio_path": audio_path,
                    "transcription_success": True,
                    "text": extracted_text,
                    "language": extracted_language,
                    "language_probability": result.get("language_probability", 0.0),
                    "segments": extracted_segments,
                    "transcription_timestamp": datetime.now().isoformat(),
                    "model_used": self.model_name,
                    "device_used": self.device,
                    "task": task
                }
                
                # Calculate additional metrics
                if transcription_data["text"]:
                    transcription_data["word_count"] = len(transcription_data["text"].split())
                    transcription_data["character_count"] = len(transcription_data["text"])
                    transcription_data["confidence_score"] = self._calculate_confidence(result.get("segments", []))
                    logger.info(f"[TRANSCRIPTION] SUCCESS: Transcription completed")
                    logger.info(f"[TRANSCRIPTION] Text: {extracted_text[:100]}..." if len(extracted_text) > 100 else f"[TRANSCRIPTION] Text: {extracted_text}")
                    logger.info(f"[TRANSCRIPTION] Word count: {transcription_data.get('word_count', 0)}, Character count: {transcription_data.get('character_count', 0)}")
                else:
                    logger.warning(f"[TRANSCRIPTION] WARNING: Transcription returned empty text")
                    logger.warning(f"[TRANSCRIPTION] Language detected: {extracted_language}, but no text extracted")
                
                logger.info(f"[TRANSCRIPTION] Language detected: {transcription_data['language']} (confidence: {transcription_data['language_probability']:.2f})")
                
                # Log debug information
                debug_helper.log_debug_info(
                    "whisper_transcription_success",
                    {
                        "audio_path": audio_path,
                        "language": transcription_data["language"],
                        "word_count": transcription_data.get("word_count", 0),
                        "confidence_score": transcription_data.get("confidence_score", 0.0),
                        "model_used": self.model_name
                    }
                )
                
                return transcription_data
                
            except Exception as e:
                transcription_elapsed = time.perf_counter() - transcription_start_time
                logger.error(f"[TRANSCRIPTION] FAILED: Transcription failed for {audio_path} after {transcription_elapsed:.2f}s")
                logger.error(f"[TRANSCRIPTION] Error type: {type(e).__name__}")
                logger.error(f"[TRANSCRIPTION] Error message: {str(e)}")
                import traceback
                logger.debug(f"[TRANSCRIPTION] Traceback:\n{traceback.format_exc()}")
                
                debug_helper.capture_exception(
                    "whisper_transcription",
                    e,
                    {"audio_path": audio_path, "language": language, "task": task}
                )
                
                return {
                    "audio_path": audio_path,
                    "transcription_success": False,
                    "error": str(e),
                    "transcription_timestamp": datetime.now().isoformat(),
                    "model_used": self.model_name,
                    "device_used": self.device
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
        """Decode a base64 snippet, normalize it, and run Whisper transcription."""

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
            "[DICTATION] snippet received size_bytes=%s media_type=%s",
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
                "[DICTATION] snippet transcription complete duration_ms=%s text_len=%s",
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

    def transcribe_in_chunks(
        self,
        audio_path: str,
        chunk_sec: int = 15,
        stride_sec: int = 5,
        language: Optional[str] = None,
        task: str = "transcribe",
    ) -> Generator[Dict[str, Any], None, Dict[str, Any]]:
        """
        Progressive transcription: yields partial text per chunk and returns a final summary.
        
        Note: Default chunk_sec=15 is for backward compatibility. In production, 
        larger chunks (e.g., 3600 seconds = 60 minutes) are typically used for better 
        performance with large files.

        Args:
            audio_path: Path to audio file to transcribe
            chunk_sec: Duration of each chunk in seconds (default: 15, typical: 3600 for large files)
            stride_sec: Overlap between chunks in seconds (default: 5, typical: 60 for large files)
            language: Language code (e.g., 'en', 'es') or None for auto-detection
            task: Task type ('transcribe' or 'translate')

        Yields:
            {"chunk_index", "start_sec", "end_sec", "text"}

        Returns (via StopIteration.value):
            Final dict with accumulated text and metadata (same spirit as transcribe_audio).
        """
        logger.info(f"Starting chunked transcription: {audio_path} (chunk={chunk_sec}s, stride={stride_sec}s)")

        if not _transcription_enabled():
            raise RuntimeError("Transcription disabled via env")

        self.ensure_loaded()

        # Determine duration (best-effort)
        try:
            from .audio_processor import audio_processor as _ap
            info = _ap.analyze_audio_file(audio_path)
            total_duration = float(info.get("duration_seconds") or 0.0)
        except Exception:
            total_duration = 0.0

        # Build chunk schedule
        idx = 0
        start = 0.0
        final_text_parts: List[str] = []
        detected_language = None  # Will be set from first chunk
        chunk_files_to_cleanup: List[str] = []  # Track files for cleanup
        
        options: Dict[str, Any] = {
            "task": task,
            "verbose": False,
            "fp16": False,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "no_speech_threshold": 0.3,
        }
        forced_lang = _forced_language()
        lang_to_use = language or forced_lang
        if lang_to_use:
            options["language"] = lang_to_use

        try:
            while True:
                end = start + float(chunk_sec)
                # Guard last chunk if total is known
                duration = float(chunk_sec)
                if total_duration and end > total_duration + 0.25:
                    # No more audio expected
                    break
                # Extract segment
                seg = audio_processor.extract_audio_segment(audio_path, start_time=start, duration=duration, output_format="wav")
                if not seg.get("extraction_success"):
                    logger.warning(f"Chunk extraction failed at {start}s: {seg.get('error')}. Continuing with next chunk.")
                    # Continue with next chunk instead of breaking
                    start += max(0.1, float(chunk_sec - stride_sec))
                    if total_duration and start >= total_duration:
                        break
                    continue
                
                seg_path = seg["output_path"]
                chunk_files_to_cleanup.append(seg_path)  # Track for cleanup
                
                # Transcribe segment
                try:
                    result = self.model.transcribe(seg_path, **options)
                    text = (result.get("text") or "").strip()
                    
                    # Detect language from first chunk if not already set
                    if detected_language is None and result.get("language"):
                        detected_language = result.get("language")
                        # Update options to use detected language for subsequent chunks
                        if not lang_to_use:  # Only if language wasn't forced
                            options["language"] = detected_language
                            logger.info(f"Language detected from first chunk: {detected_language}. Using for subsequent chunks.")
                    
                except Exception as e:
                    logger.error(f"Chunk transcription failed at {start}s: {e}. Continuing with next chunk.")
                    debug_helper.capture_exception("whisper_chunk_transcription", e, {"start": start, "duration": duration})
                    text = ""
                    # Continue with next chunk instead of breaking
                    start += max(0.1, float(chunk_sec - stride_sec))
                    if total_duration and start >= total_duration:
                        break
                    continue

                yield {
                    "chunk_index": idx,
                    "start_sec": round(start, 3),
                    "end_sec": round(start + duration, 3),
                    "text": text,
                }
                if text:
                    final_text_parts.append(text)

                idx += 1
                # Advance with stride (overlap = chunk - stride)
                start += max(0.1, float(chunk_sec - stride_sec))
                if total_duration and start >= total_duration:
                    break
        finally:
            # Clean up extracted chunk files - always execute, even if transcription is interrupted
            cleanup_count = 0
            for chunk_file in chunk_files_to_cleanup:
                try:
                    if os.path.exists(chunk_file):
                        os.remove(chunk_file)
                        cleanup_count += 1
                except Exception as e:
                    logger.warning(f"Failed to cleanup chunk file {chunk_file}: {e}")
            
            if cleanup_count > 0:
                logger.info(f"Cleaned up {cleanup_count} chunk file(s) after transcription")

        final_text = " ".join(final_text_parts).strip()
        # Use detected language if available, otherwise fall back to provided or unknown
        final_language = detected_language or language or "unknown"
        summary = {
            "audio_path": audio_path,
            "transcription_success": True,
            "text": final_text,
            "language": final_language,
            "transcription_timestamp": datetime.now().isoformat(),
            "model_used": self.model_name,
            "device_used": self.device,
            "chunk_count": idx,
        }
        return summary
    
    @log_function_call
    def save_transcript(
        self,
        call_id: str,
        transcription_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Save transcription results to file and database.
        
        Args:
            transcription_data: Transcription results from Whisper
            call_id: Unique call identifier
            
        Returns:
            Dictionary with save operation results
        """
        logger.info(f"Saving transcript for call: {call_id}")
        
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
            transcript_data = {
                "call_id": call_id,
                "transcription": transcription_data,
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "model_used": transcription_data.get("model_used", "unknown"),
                    "device_used": transcription_data.get("device_used", "unknown"),
                    "file_path": str(transcript_path)
                }
            }
            
            # Save to JSON file
            with open(transcript_path, 'w', encoding='utf-8') as f:
                json.dump(transcript_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Transcript saved to: {transcript_path}")
            
            # Log debug information
            debug_helper.log_debug_info(
                "transcript_saved",
                {
                    "call_id": call_id,
                    "transcript_path": str(transcript_path),
                    "file_size_bytes": transcript_path.stat().st_size,
                    "word_count": transcription_data.get("word_count", 0)
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
            logger.error(f"Failed to save transcript for call {call_id}: {e}")
            debug_helper.capture_exception(
                "transcript_save",
                e,
                {"call_id": call_id, "transcription_data_keys": list(transcription_data.keys()) if isinstance(transcription_data, dict) else "Not a dictionary"}
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
        Get list of available Whisper models.
        
        Returns:
            List of available model names
        """
        if _WHISPER_AVAILABLE:
            # Limit to core multilingual variants to align with MLX backend.
            supported = ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"]
            return [name for name in supported if name in getattr(whisper, "_MODELS", {})]
        return ["tiny"]

    def is_model_cached(self, model_name: str) -> bool:
        """
        Check whether a whisper checkpoint already exists in the local cache.
        """
        if not _WHISPER_AVAILABLE:
            return False

        models_map = getattr(whisper, "_MODELS", {})
        url = models_map.get(model_name)
        if not url:
            return False
        cache_path = _whisper_cache_root() / Path(url).name
        return cache_path.exists()

    def download_model(self, model_name: str) -> bool:
        """
        Download a whisper checkpoint into the cache without permanently loading it.
        """
        if not _WHISPER_AVAILABLE:
            raise RuntimeError("Whisper/Torch not available")

        models_map = getattr(whisper, "_MODELS", {})
        if model_name not in models_map:
            raise ValueError(f"Unsupported model name '{model_name}'")

        cache_root = _whisper_cache_root()
        cache_root.mkdir(parents=True, exist_ok=True)

        # Trigger the download using whisper's internal helper to avoid holding the model in memory.
        whisper._download(models_map[model_name], str(cache_root), in_memory=False)  # type: ignore[attr-defined]
        return True

    def reload_model(self, model_name: str) -> bool:
        """
        Reload the active whisper model, switching to a newly downloaded checkpoint.
        """
        if not _WHISPER_AVAILABLE:
            raise RuntimeError("Whisper/Torch not available")

        with self._load_lock:
            try:
                self.model_name = model_name
                self.model = None
                self._model_loaded = False
                return self._load_model()
            except Exception as exc:  # pragma: no cover - error path logged, re-raised
                logger.error(f"Failed to switch Whisper model to {model_name}: {exc}")
                raise
    
    @log_function_call
    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the currently loaded model.
        
        Returns:
            Dictionary with model information
        """
        if not self.model:
            return {
                "model_loaded": False,
                "error": "No model loaded"
            }
        
        try:
            # Calculate model size
            total_params = sum(p.numel() for p in self.model.parameters())
            total_size_mb = sum(p.numel() * p.element_size() for p in self.model.parameters()) / (1024 * 1024)
            
            return {
                "model_loaded": True,
                "model_name": self.model_name,
                "device": self.device,
                "total_parameters": total_params,
                "model_size_mb": round(total_size_mb, 2),
                "cuda_available": torch.cuda.is_available(),
                "cuda_device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0
            }
        except Exception as e:
            logger.error(f"Error getting model info: {e}")
            return {
                "model_loaded": True,
                "model_name": self.model_name,
                "device": self.device,
                "error": str(e)
            }

# Global Whisper processor instance - DO NOT USE DIRECTLY
# Use get_global_whisper_processor() from whisper_backend_selector instead
# This is kept for backwards compatibility only
whisper_processor = WhisperProcessor(model_name="base")
