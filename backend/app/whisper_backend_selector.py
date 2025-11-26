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
from typing import Union

logger = logging.getLogger('transcriptai.whisper_backend_selector')

# Try to import both backends
_PYTORCH_AVAILABLE = False
_MLX_AVAILABLE = False

try:
    from .whisper_processor import WhisperProcessor
    _PYTORCH_AVAILABLE = True
except ImportError as e:
    logger.warning(f"PyTorch Whisper backend not available: {e}")

_mlx_probe = lambda: False  # type: ignore

try:
    from .whisper_processor_mlx import WhisperProcessorMLX, is_mlx_available as _mlx_available_probe
    # Probe MLX availability - this may fail due to import errors or version mismatches
    # We catch all exceptions to prevent startup crashes
    try:
        _MLX_AVAILABLE = _mlx_available_probe()
        _mlx_probe = _mlx_available_probe
    except Exception as probe_error:
        logger.debug(f"MLX availability probe failed: {probe_error} (type: {type(probe_error).__name__})")
        _MLX_AVAILABLE = False
        _mlx_probe = lambda: False  # type: ignore
except (ImportError, AttributeError, Exception) as e:
    logger.debug(f"MLX Whisper backend not available: {e} (type: {type(e).__name__})")
    _MLX_AVAILABLE = False
    _mlx_probe = lambda: False  # type: ignore


def should_use_mlx() -> bool:
    """
    Determine if MLX backend should be used.
    
    Decision criteria:
    1. If TRANSCRIPTAI_USE_MLX=1, use MLX (if available)
    2. If TRANSCRIPTAI_USE_MLX=0, use PyTorch
    3. If not set, auto-detect:
       - Use MLX on macOS with Apple Silicon (if available)
       - Otherwise use PyTorch
    
    Returns:
        True if MLX should be used, False for PyTorch
    """
    # Explicit environment variable takes precedence
    env_mlx = os.getenv("TRANSCRIPTAI_USE_MLX", "").strip()
    mlx_available = _mlx_probe()
    global _MLX_AVAILABLE
    _MLX_AVAILABLE = mlx_available
    
    # Debug logging to diagnose environment variable issues
    logger.info(f"🔍 [MLX ENV CHECK] TRANSCRIPTAI_USE_MLX='{env_mlx}' (from os.getenv)")
    
    if env_mlx == "1":
        if mlx_available:
            logger.info("MLX backend explicitly enabled via TRANSCRIPTAI_USE_MLX=1")
            return True
        else:
            logger.warning("MLX backend requested but not available, falling back to PyTorch")
            return False
    
    if env_mlx == "0":
        logger.info("MLX backend explicitly disabled via TRANSCRIPTAI_USE_MLX=0")
        return False
    
    # Auto-enable MLX on Apple Silicon (when env var not set)
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        if mlx_available:
            logger.info("Auto-selecting MLX backend for Apple Silicon (3.25x faster)")
            return True
        else:
            logger.debug("MLX not available on Apple Silicon, using PyTorch")
            return False
    
    # Default to PyTorch for other platforms
    logger.debug("Using PyTorch backend (default)")
    return False


def get_whisper_processor(model_name: str = "tiny") -> Union['WhisperProcessor', 'WhisperProcessorMLX']:
    """
    Get the appropriate Whisper processor based on environment and availability.
    
    Args:
        model_name: Whisper model size (tiny, base, small, medium, large)
        
    Returns:
        WhisperProcessor or WhisperProcessorMLX instance
        
    Raises:
        RuntimeError: If no backend is available
    """
    use_mlx = should_use_mlx()
    
    if use_mlx:
        if _mlx_probe():
            try:
                logger.info(f"Creating MLX Whisper processor with model: {model_name}")
                return WhisperProcessorMLX(model_name=model_name)
            except RuntimeError as err:
                logger.warning(f"Failed to initialize MLX backend ({err}), falling back to PyTorch")
                _MLX_AVAILABLE = False
        else:
            logger.warning("MLX backend not available, falling back to PyTorch")
        use_mlx = False
    
    if not use_mlx:
        if _PYTORCH_AVAILABLE:
            logger.info(f"Creating PyTorch Whisper processor with model: {model_name}")
            return WhisperProcessor(model_name=model_name)
        else:
            raise RuntimeError("No Whisper backend available (neither PyTorch nor MLX)")
    
    raise RuntimeError("Failed to create Whisper processor")


def get_backend_info() -> dict:
    """
    Get information about available backends and current selection.
    
    Returns:
        Dictionary with backend availability and selection info
    """
    return {
        "pytorch_available": _PYTORCH_AVAILABLE,
        "mlx_available": _mlx_probe(),
        "should_use_mlx": should_use_mlx(),
        "platform": platform.system(),
        "machine": platform.machine(),
        "env_mlx_flag": os.getenv("TRANSCRIPTAI_USE_MLX", "not_set"),
    }


# Global processor instance (lazy-loaded for backward compatibility)
_global_processor = None


from pathlib import Path
import json
from .config import settings

def get_model_preference_path() -> Path:
    """Get path to the model preference file."""
    # Use the upload_dir (which is in the data dir) as a base
    data_dir = Path(settings.upload_dir).parent
    return data_dir / "model_preference.json"

def get_global_whisper_processor():
    """
    Get or create the global Whisper processor instance.
    
    This maintains backward compatibility with code that imports
    whisper_processor directly.
    
    Returns:
        Global WhisperProcessor or WhisperProcessorMLX instance
    """
    global _global_processor
    
    if _global_processor is None:
        # Determine model name based on existing config
        # Default to 'base' for compatibility with existing code
        model_name = "base"
        
        # Override with 'tiny' if MLX is being used (for performance)
        if should_use_mlx():
            model_name = "tiny"
            
            # Check for persisted preference
            try:
                pref_path = get_model_preference_path()
                if pref_path.exists():
                    with open(pref_path, 'r') as f:
                        data = json.load(f)
                        if "model_name" in data:
                            model_name = data["model_name"]
                            logger.info(f"Loaded persisted model preference: {model_name}")
            except Exception as e:
                logger.warning(f"Failed to load model preference: {e}")
        
        _global_processor = get_whisper_processor(model_name=model_name)
        logger.info(f"Global Whisper processor created: {_global_processor.__class__.__name__}")
    
    return _global_processor
