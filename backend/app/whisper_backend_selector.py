"""
Backend selector for Whisper transcription.

Strictly uses the PyTorch/C++ backend.
"""
import os
import platform
import logging
import threading
from typing import Union, Optional
from pathlib import Path
import json
from .config import settings

logger = logging.getLogger('transcriptai.whisper_backend_selector')

# Global processor instances
_pytorch_processor = None
_current_processor = None
_processor_lock = threading.Lock()

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
    """
    global _current_processor, _pytorch_processor
    
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

        # Initializing PyTorch Whisper processor
        WhisperProcessorClass = _import_pytorch_processor()
        if WhisperProcessorClass:
            try:
                _pytorch_processor = WhisperProcessorClass(model_name=final_model_name)
                _current_processor = _pytorch_processor
                logger.info(f"✅ PyTorch/C++ processor ready with model: {final_model_name}")
                return _current_processor
            except Exception as e:
                logger.error(f"Failed to create PyTorch processor: {e}")
                raise RuntimeError(f"Failed to create PyTorch processor: {e}")
        
        raise RuntimeError("No Whisper backend available")

def get_backend_info() -> dict:
    return {
        "pytorch_available": _import_pytorch_processor() is not None,
        "mlx_available": False,
        "should_use_mlx": False,
        "platform": platform.system(),
        "machine": platform.machine(),
    }

