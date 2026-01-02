"""
Backend selector for Whisper transcription.

Dynamically selects between PyTorch and MLX backends based on:
1. Environment variable TRANSCRIPTAI_USE_MLX
2. Platform detection (macOS with Apple Silicon)
3. Availability of MLX libraries

This provides a single interface for the application to get the appropriate
Whisper processor without needing to know which backend is being used.
"""
import os
import platform
import logging
import time
import threading
from typing import Union, Optional
from pathlib import Path
import json
from .config import settings

logger = logging.getLogger('transcriptai.whisper_backend_selector')

# Initialize startup logger for timing logs
startup_logger = logging.getLogger("transcriptai.startup")
if not startup_logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(message)s'))
    startup_logger.addHandler(handler)
    startup_logger.setLevel(logging.INFO)
    startup_logger.propagate = False

# Global processor instances
_pytorch_processor = None
_mlx_processor = None
_current_processor = None
_processor_lock = threading.Lock()
_mlx_loaded = False

# Valid model names
_VALID_MODEL_NAMES = {"tiny", "base", "small", "medium", "large", "large-v2", "large-v3"}

def _validate_model_name(model_name: str) -> str:
    """Validate and normalize model name."""
    if model_name not in _VALID_MODEL_NAMES:
        logger.warning(f"Invalid model name '{model_name}', defaulting to 'base'")
        return "base"
    return model_name

def get_model_preference_path() -> Path:
    """Get path to the model preference file."""
    data_dir = Path(settings.upload_dir).parent
    return data_dir / "model_preference.json"

def should_use_mlx() -> bool:
    """
    Determine if MLX backend should be used.
    """
    env_mlx = os.getenv("TRANSCRIPTAI_USE_MLX", "").strip()
    
    logger.debug(f"🔍 [MLX ENV CHECK] TRANSCRIPTAI_USE_MLX='{env_mlx}'")
    
    if env_mlx == "1":
        logger.info("MLX backend explicitly enabled via TRANSCRIPTAI_USE_MLX=1")
        return True
    
    if env_mlx == "0":
        logger.info("MLX backend explicitly disabled via TRANSCRIPTAI_USE_MLX=0")
        return False
    
    logger.info("Defaulting to PyTorch backend (TRANSCRIPTAI_USE_MLX not set)")
    return False

def _import_pytorch_processor():
    """Lazy import PyTorch processor."""
    try:
        from .whisper_processor import WhisperProcessor
        return WhisperProcessor
    except ImportError as e:
        logger.warning(f"PyTorch Whisper backend not available: {e}")
        return None

def get_global_whisper_processor(model_name: str = "tiny"):
    """
    Get or create the global Whisper processor instance.
    
    Strategy:
    1. If MLX is enabled, try to load it directly (avoiding PyTorch import to prevent version conflicts).
    2. If MLX fails or is disabled, fall back to PyTorch.
    """
    global _current_processor, _mlx_loaded, _mlx_processor, _pytorch_processor
    
    with _processor_lock:
        if _current_processor:
            return _current_processor

        # Determine model name
        final_model_name = "base"
        try:
            pref_path = get_model_preference_path()
            if pref_path.exists():
                with open(pref_path, 'r') as f:
                    data = json.load(f)
                    if "model_name" in data:
                        final_model_name = _validate_model_name(data["model_name"])
        except Exception:
            pass
        
        if model_name and model_name != "tiny":
            final_model_name = _validate_model_name(model_name)

        # 1. Try MLX if enabled
        if should_use_mlx():
            try:
                logger.info("Attempting to load MLX Whisper processor...")
                # Import MLX processor (this activates venv_mlx)
                from .whisper_processor_mlx import WhisperProcessorMLX, is_mlx_available
                
                if is_mlx_available():
                    _mlx_processor = WhisperProcessorMLX(model_name=final_model_name)
                    _current_processor = _mlx_processor
                    _mlx_loaded = True
                    logger.info(f"✅ MLX processor ready with model: {final_model_name}")
                    return _current_processor
                else:
                    logger.warning("MLX available probe failed, falling back to PyTorch")
            except Exception as e:
                logger.error(f"Failed to initialize MLX backend: {e}")
                logger.warning("Falling back to PyTorch")

        # 2. Fallback to PyTorch
        logger.info("Initializing PyTorch Whisper processor...")
        WhisperProcessorClass = _import_pytorch_processor()
        if WhisperProcessorClass:
            try:
                _pytorch_processor = WhisperProcessorClass(model_name=final_model_name)
                _current_processor = _pytorch_processor
                logger.info(f"✅ PyTorch processor ready with model: {final_model_name}")
                return _current_processor
            except Exception as e:
                logger.error(f"Failed to create PyTorch processor: {e}")
                raise RuntimeError(f"Failed to create PyTorch processor: {e}")
        
        raise RuntimeError("No Whisper backend available")

def get_backend_info() -> dict:
    return {
        "pytorch_available": _import_pytorch_processor() is not None,
        "mlx_available": _mlx_loaded,
        "should_use_mlx": should_use_mlx(),
        "platform": platform.system(),
        "machine": platform.machine(),
        "env_mlx_flag": os.getenv("TRANSCRIPTAI_USE_MLX", "not_set"),
    }

