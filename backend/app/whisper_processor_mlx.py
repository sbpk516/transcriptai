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

# Initialize startup logger for timing logs
startup_logger = logging.getLogger("transcriptai.startup")
if not startup_logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(message)s'))
    startup_logger.addHandler(handler)
    startup_logger.setLevel(logging.INFO)
    startup_logger.propagate = False

mlx_whisper = None
_MLX_AVAILABLE = False


def _ensure_mlx_import(reason: str) -> bool:
    """
    Ensure MLX libraries are imported.
    
    BREAKDOWN OF MLX IMPORT:
    This is a CRITICAL bottleneck - importing mlx_whisper triggers imports of:
    - mlx (Apple's ML framework)
    - mlx.nn, mlx.core (heavy C++ extensions)
    - transformers (HuggingFace)
    - numpy, etc.
    
    This can take 10-30 seconds depending on system.
    """
    global mlx_whisper, _MLX_AVAILABLE

    if _MLX_AVAILABLE and mlx_whisper is not None:
        return True

    _import_start = time.perf_counter()
    try:
        mlx_whisper = importlib.import_module("mlx_whisper")
        _import_elapsed = (time.perf_counter() - _import_start) * 1000
        startup_logger.info("[PYTHON_INIT] phase=import_mlx_whisper elapsed=%.3fms reason=%s", _import_elapsed, reason)
        
        # Verify the import actually works by checking for a key attribute
        # This catches AttributeError issues like mlx.core.array not existing
        if hasattr(mlx_whisper, 'transcribe'):
            _MLX_AVAILABLE = True
            return True
        else:
            raise AttributeError("mlx_whisper module missing required 'transcribe' function")
    except (ImportError, AttributeError, ModuleNotFoundError) as initial_error:
        _import_elapsed = (time.perf_counter() - _import_start) * 1000
        startup_logger.info("[PYTHON_INIT] phase=import_mlx_whisper elapsed=%.3fms (failed: %s)", _import_elapsed, str(initial_error))
        
        # Try activating MLX site packages and retry
        _activate_start = time.perf_counter()
        if activate_mlx_site_packages(reason=reason, log=logger):
            _activate_elapsed = (time.perf_counter() - _activate_start) * 1000
            startup_logger.info("[PYTHON_INIT] phase=activate_mlx_site_packages elapsed=%.3fms", _activate_elapsed)
            
            _retry_start = time.perf_counter()
            try:
                mlx_whisper = importlib.import_module("mlx_whisper")
                _retry_elapsed = (time.perf_counter() - _retry_start) * 1000
                startup_logger.info("[PYTHON_INIT] phase=import_mlx_whisper_retry elapsed=%.3fms", _retry_elapsed)
                
                if hasattr(mlx_whisper, 'transcribe'):
                    _MLX_AVAILABLE = True
                    return True
                else:
                    raise AttributeError("mlx_whisper module missing required 'transcribe' function")
            except (ImportError, AttributeError, ModuleNotFoundError) as retry_error:
                _retry_elapsed = (time.perf_counter() - _retry_start) * 1000
                startup_logger.info("[PYTHON_INIT] phase=import_mlx_whisper_retry elapsed=%.3fms (failed: %s)", _retry_elapsed, str(retry_error))
                logger.debug("MLX import failed after activation: %s", retry_error)
        else:
            _activate_elapsed = (time.perf_counter() - _activate_start) * 1000
            startup_logger.info("[PYTHON_INIT] phase=activate_mlx_site_packages elapsed=%.3fms (failed)", _activate_elapsed)
            logger.debug("MLX site-packages activation failed for reason=%s", reason)

        logger.debug("MLX import failed: %s (type: %s)", initial_error, type(initial_error).__name__)
        mlx_whisper = None
        _MLX_AVAILABLE = False
        return False
    except Exception as unexpected_error:
        _import_elapsed = (time.perf_counter() - _import_start) * 1000
        startup_logger.info("[PYTHON_INIT] phase=import_mlx_whisper elapsed=%.3fms (unexpected error: %s)", _import_elapsed, str(unexpected_error))
        # Catch any other unexpected errors during import
        logger.warning("Unexpected error during MLX import: %s (type: %s)", unexpected_error, type(unexpected_error).__name__)
        mlx_whisper = None
        _MLX_AVAILABLE = False
        return False


def is_mlx_available() -> bool:
    """Public helper to probe MLX availability without raising."""
    return _ensure_mlx_import("availability_probe")

def _transcription_enabled() -> bool:
    """Check if transcription is enabled. Defaults to enabled (1) for normal operation."""
    enabled = os.getenv("TRANSCRIPTAI_ENABLE_TRANSCRIPTION", "1") == "1"
    if not enabled:
        logger.warning("[TRANSCRIPTION] Transcription is DISABLED via TRANSCRIPTAI_ENABLE_TRANSCRIPTION=0")
    else:
        logger.debug("[TRANSCRIPTION] Transcription is ENABLED")
    return enabled

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

        _init_mlx_start = time.perf_counter()
        if not _ensure_mlx_import("whisper_processor_mlx_init"):
            _init_mlx_elapsed = (time.perf_counter() - _init_mlx_start) * 1000
            startup_logger.info("[PYTHON_INIT] phase=whisper_processor_mlx_init elapsed=%.3fms (failed)", _init_mlx_elapsed)
            logger.warning("MLX/mlx-whisper not available. Instance cannot process audio.")
            raise RuntimeError("MLX runtime unavailable")
        else:
            _init_mlx_elapsed = (time.perf_counter() - _init_mlx_start) * 1000
            startup_logger.info("[PYTHON_INIT] phase=whisper_processor_mlx_init elapsed=%.3fms", _init_mlx_elapsed)
        
        if not _transcription_enabled():
            logger.warning("Transcription disabled via TRANSCRIPTAI_ENABLE_TRANSCRIPTION=0")
        if not _MLX_AVAILABLE:
            logger.warning("MLX/mlx-whisper not available. Transcription disabled.")
        
        logger.info(f"MLX Whisper processor initialized with model: {model_name} on {self.device}")
    
    def _load_model(self) -> bool:
        """
        Load MLX Whisper model.
        
        BREAKDOWN OF MODEL LOADING:
        
        IMPORTANT: This function does NOT download or load model weights.
        It only stores the HuggingFace model ID string.
        
        What happens:
        1. Creates model_id: "mlx-community/whisper-{model_name}"
        2. Stores model_id in self.model
        3. Sets _model_loaded = True flag
        4. Takes ~0.001 seconds (1 millisecond)
        
        Actual model weight loading:
        - Happens lazily when transcribe_audio() is first called
        - mlx_whisper.transcribe() downloads weights from HuggingFace if not cached
        - First transcription: ~5-10 seconds (download + load)
        - Subsequent transcriptions: ~1-2 seconds (weights already in memory)
        
        Why this design:
        - Avoids downloading large model files during startup
        - Model weights only loaded when actually needed
        - Status becomes "ready" immediately (for UI feedback)
        - Actual loading happens on-demand
        
        Returns:
            True if model loaded successfully, False otherwise
        """
        _load_start = time.perf_counter()
        _load_timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        startup_logger.info("[MLX_WHISPER] phase=model_load_start timestamp=%s model_name=%s", _load_timestamp, self.model_name)
        try:
            logger.info(f"Loading MLX Whisper model: {self.model_name}")

            with PerformanceMonitor("mlx_whisper_model_loading") as monitor:
                _mlx_check_start = time.perf_counter()
                if not _MLX_AVAILABLE:
                    if not _ensure_mlx_import("model_load"):
                        raise RuntimeError("MLX/mlx-whisper not available")
                _mlx_check_elapsed = (time.perf_counter() - _mlx_check_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=mlx_availability_check elapsed=%.3fms", _mlx_check_elapsed)
                
                # MLX models are auto-downloaded from HuggingFace
                # Format: "mlx-community/whisper-{model_name}"
                _model_id_start = time.perf_counter()
                model_id = f"mlx-community/whisper-{self.model_name}"
                _model_id_elapsed = (time.perf_counter() - _model_id_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=model_id_prepare elapsed=%.3fms model_id=%s", _model_id_elapsed, model_id)
                
                logger.info(f"Loading MLX model from: {model_id}")
                
                # Load model using mlx_whisper
                # Note: mlx_whisper.load_model returns model weights, not a model object
                # The transcribe function handles loading internally
                # 
                # IMPORTANT: We only store the model_id here, NOT the actual weights.
                # Model weights are downloaded/loaded lazily when transcribe_audio() is first called.
                # This makes startup fast (~0.001s) but first transcription slower (~5-10s).
                _model_store_start = time.perf_counter()
                self.model = model_id  # Store model ID for transcription (not weights!)
                _model_store_elapsed = (time.perf_counter() - _model_store_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=model_store elapsed=%.3fms", _model_store_elapsed)
                
                logger.info(f"MLX Whisper model {self.model_name} loaded successfully on {self.device}")

                _model_info_start = time.perf_counter()
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
                _model_info_elapsed = (time.perf_counter() - _model_info_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=model_info_log elapsed=%.3fms", _model_info_elapsed)

                self._model_loaded = True
                self._last_load_error = None
                _load_total_elapsed = (time.perf_counter() - _load_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=model_load_complete elapsed=%.3fms", _load_total_elapsed)
                return True

        except Exception as e:
            _load_error_elapsed = (time.perf_counter() - _load_start) * 1000
            startup_logger.error("[MLX_WHISPER] phase=model_load_error elapsed=%.3fms error=%s", _load_error_elapsed, str(e))
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

        _ensure_start = time.perf_counter()
        _ensure_timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        startup_logger.info("[MLX_WHISPER] phase=ensure_loaded_start timestamp=%s background=%s", _ensure_timestamp, background)
        
        acquired = False
        start_wait = time.perf_counter()
        try:
            if timeout is None:
                self._load_lock.acquire()
                acquired = True
            else:
                acquired = self._load_lock.acquire(timeout=timeout)
            lock_wait_elapsed = time.perf_counter() - start_wait
            startup_logger.info("[MLX_WHISPER] phase=lock_acquired elapsed=%.3fms", lock_wait_elapsed * 1000)
            if not acquired:
                waited = time.perf_counter() - start_wait
                self._last_load_error = f"timeout after {waited:.3f}s waiting for MLX Whisper model load lock"
                startup_logger.error("[MLX_WHISPER] phase=lock_timeout elapsed=%.3fms", waited * 1000)
                raise TimeoutError(self._last_load_error)

            if self._model_loaded:
                startup_logger.info("[MLX_WHISPER] phase=ensure_loaded_skip already_loaded=1")
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
                _ensure_total_elapsed = (time.perf_counter() - _ensure_start) * 1000
                startup_logger.info("[MLX_WHISPER] phase=ensure_loaded_complete elapsed=%.3fms", _ensure_total_elapsed)
            else:
                self._last_load_error = "MLX Whisper model failed to load"
                logger.error(
                    "[MLX WHISPER] model_load status=failed elapsed=%.3fs", elapsed
                )
                _ensure_total_elapsed = (time.perf_counter() - _ensure_start) * 1000
                startup_logger.error("[MLX_WHISPER] phase=ensure_loaded_failed elapsed=%.3fms", _ensure_total_elapsed)
                raise RuntimeError("MLX Whisper model failed to load")
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
        logger.info(f"[TRANSCRIPTION] Starting MLX transcription: {audio_path}")
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
        logger.debug(f"[TRANSCRIPTION] Ensuring MLX model is loaded (model_name={self.model_name})")
        try:
            model_loaded = self.ensure_loaded()
            if model_loaded:
                logger.debug(f"[TRANSCRIPTION] MLX model already loaded")
            else:
                logger.info(f"[TRANSCRIPTION] MLX model loaded successfully")
        except TimeoutError as exc:
            error_msg = f"MLX Whisper model load timed out: {exc}"
            logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
            logger.error(f"[TRANSCRIPTION] MLX model loading timed out after waiting")
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }
        except Exception as exc:
            error_msg = f"MLX Whisper model load failed: {exc}"
            logger.error(f"[TRANSCRIPTION] FAILED: {error_msg}")
            logger.error(f"[TRANSCRIPTION] Exception during MLX model load: {type(exc).__name__}: {exc}")
            import traceback
            logger.debug(f"[TRANSCRIPTION] MLX model load traceback:\n{traceback.format_exc()}")
            return {
                "audio_path": audio_path,
                "transcription_success": False,
                "error": error_msg,
                "transcription_timestamp": datetime.now().isoformat()
            }

        with PerformanceMonitor("mlx_whisper_transcription") as monitor:
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
                # NOTE: This is where actual model weights are downloaded/loaded.
                # mlx_whisper.transcribe() will:
                # 1. Check HuggingFace cache for model weights
                # 2. Download from HuggingFace if not cached (~5-10s first time)
                # 3. Load weights into memory (~1-2s)
                # 4. Perform transcription
                # Subsequent calls use cached weights (faster).
                
                # Try to use cached model first, fallback to HuggingFace repo
                model_path_or_repo = self.model  # Default: HuggingFace repo ID
                
                # Check if model is cached locally to avoid download
                try:
                    from huggingface_hub import snapshot_download
                    from pathlib import Path
                    # os is already imported at module level
                    
                    hf_cache = Path.home() / ".cache" / "huggingface" / "hub"
                    cached_model_dir = hf_cache / f"models--mlx-community--whisper-{self.model_name.replace('--', '--')}"
                    
                    if cached_model_dir.exists():
                        # Find the latest snapshot
                        snapshots_dir = cached_model_dir / "snapshots"
                        if snapshots_dir.exists():
                            snapshots = [d for d in snapshots_dir.iterdir() if d.is_dir()]
                            if snapshots:
                                latest_snapshot = max(snapshots, key=lambda x: x.stat().st_mtime)
                                model_path_or_repo = str(latest_snapshot)
                                logger.info(f"Using cached MLX model from: {model_path_or_repo}")
                except Exception as cache_check_error:
                    logger.debug(f"Could not check cache, using HuggingFace repo: {cache_check_error}")
                    # Continue with HuggingFace repo
                
                try:
                    result = mlx_whisper.transcribe(
                        audio_path,
                        path_or_hf_repo=model_path_or_repo,  # Use cached path or HuggingFace repo ID
                        **options
                    )
                except Exception as download_error:
                    # Handle HuggingFace download errors (401, network issues, etc.)
                    error_msg = str(download_error)
                    logger.error(f"MLX Whisper transcription failed (model download error): {error_msg}")
                    
                    # Check if it's a HuggingFace authentication/download error
                    if "401" in error_msg or "RepositoryNotFoundError" in error_msg or "huggingface" in error_msg.lower():
                        logger.warning(f"MLX model download failed. This may be due to HuggingFace authentication or network issues.")
                        logger.warning(f"Consider pre-downloading the model or using PyTorch backend as fallback.")
                    
                    # Return error result
                    return {
                        "audio_path": audio_path,
                        "transcription_success": False,
                        "error": f"MLX model download failed: {error_msg}",
                        "transcription_timestamp": datetime.now().isoformat(),
                        "model_used": self.model_name,
                        "device_used": self.device,
                        "backend": "mlx"
                    }
                
                # Extract key information (mlx_whisper returns same format as openai-whisper)
                logger.debug(f"[TRANSCRIPTION] Extracting MLX transcription data from result")
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
                    "segments": extracted_segments,
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
                    logger.info(f"[TRANSCRIPTION] SUCCESS: MLX transcription completed")
                    logger.info(f"[TRANSCRIPTION] Text: {extracted_text[:100]}..." if len(extracted_text) > 100 else f"[TRANSCRIPTION] Text: {extracted_text}")
                    logger.info(f"[TRANSCRIPTION] Word count: {transcription_data.get('word_count', 0)}, Character count: {transcription_data.get('character_count', 0)}")
                else:
                    logger.warning(f"[TRANSCRIPTION] WARNING: MLX transcription returned empty text")
                    logger.warning(f"[TRANSCRIPTION] Language detected: {extracted_language}, but no text extracted")
                
                logger.info(f"[TRANSCRIPTION] Language detected: {transcription_data['language']}")
                
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
                transcription_elapsed = time.perf_counter() - transcription_start_time
                logger.error(f"[TRANSCRIPTION] FAILED: MLX transcription failed for {audio_path} after {transcription_elapsed:.2f}s")
                logger.error(f"[TRANSCRIPTION] Error type: {type(e).__name__}")
                logger.error(f"[TRANSCRIPTION] Error message: {str(e)}")
                import traceback
                logger.debug(f"[TRANSCRIPTION] Traceback:\n{traceback.format_exc()}")
                
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

