"""
Noise suppression using RNNoise C library.
Lightweight (~3.5MB) neural network-based noise suppressor.

This module provides noise reduction functionality to clean audio
before sending to Whisper, improving transcription accuracy.
"""
import ctypes
import os
import logging
import tempfile
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

import numpy as np

from .native_libs import resolve_native_lib

logger = logging.getLogger('transcriptai.noise_processor')

# RNNoise constants
FRAME_SIZE = 480  # 10ms at 48kHz (RNNoise native rate)
RNNOISE_SAMPLE_RATE = 48000


@dataclass
class NoiseReductionResult:
    """Result of noise reduction processing."""
    success: bool
    output_path: str
    original_path: str
    sample_rate: int = 16000
    duration_seconds: float = 0.0
    error: Optional[str] = None


class RNNoiseProcessor:
    """RNNoise wrapper using ctypes."""

    def __init__(self):
        self._lib = None
        self._state = None
        self._loaded = False

    def _load_library(self) -> bool:
        """Load the RNNoise shared library (.dylib/.dll/.so depending on platform)."""
        if self._loaded:
            return self._lib is not None

        self._loaded = True

        # Resolve the platform-specific library (librnnoise.dylib / rnnoise.dll / librnnoise.so)
        lib_path = resolve_native_lib("rnnoise")
        if lib_path:
            try:
                self._lib = ctypes.CDLL(str(lib_path))
                self._setup_functions()
                logger.info(f"Loaded RNNoise from {lib_path}")
                return True
            except OSError as e:
                logger.warning(f"Failed to load {lib_path}: {e}")

        logger.warning("RNNoise library not found - noise suppression disabled")
        return False

    def _setup_functions(self):
        """Setup ctypes function signatures."""
        # rnnoise_create(model) -> DenoiseState*
        self._lib.rnnoise_create.restype = ctypes.c_void_p
        self._lib.rnnoise_create.argtypes = [ctypes.c_void_p]

        # rnnoise_destroy(state)
        self._lib.rnnoise_destroy.argtypes = [ctypes.c_void_p]
        self._lib.rnnoise_destroy.restype = None

        # rnnoise_process_frame(state, out, in) -> float (VAD probability)
        self._lib.rnnoise_process_frame.restype = ctypes.c_float
        self._lib.rnnoise_process_frame.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_float)
        ]

        # Create denoiser state (pass NULL for default model)
        self._state = self._lib.rnnoise_create(None)
        if not self._state:
            raise RuntimeError("Failed to create RNNoise state")

    def _reset_state(self):
        """Reset the denoiser state for new audio."""
        if self._lib and self._state:
            self._lib.rnnoise_destroy(self._state)
            self._state = self._lib.rnnoise_create(None)

    def process(self, audio: np.ndarray, sample_rate: int = 16000) -> np.ndarray:
        """
        Process audio through RNNoise.

        Args:
            audio: Audio samples as numpy array (float32, -1 to 1 range)
            sample_rate: Sample rate of input audio

        Returns:
            Denoised audio array
        """
        if not self._load_library() or self._state is None:
            return audio  # Fallback: return original

        # Reset state for new audio processing
        self._reset_state()

        # Ensure audio is float32
        audio = audio.astype(np.float32)

        # RNNoise expects 48kHz, resample if needed
        original_rate = sample_rate
        if sample_rate != RNNOISE_SAMPLE_RATE:
            audio = self._resample(audio, sample_rate, RNNOISE_SAMPLE_RATE)

        # RNNoise expects samples in range [-32768, 32767] (int16 range)
        # but as float values
        audio_scaled = audio * 32767.0

        # Process in frames
        num_frames = len(audio_scaled) // FRAME_SIZE
        output = np.zeros(num_frames * FRAME_SIZE, dtype=np.float32)

        for i in range(num_frames):
            start = i * FRAME_SIZE
            end = start + FRAME_SIZE

            frame_in = audio_scaled[start:end].copy()
            frame_out = np.zeros(FRAME_SIZE, dtype=np.float32)

            # Process frame
            self._lib.rnnoise_process_frame(
                self._state,
                frame_out.ctypes.data_as(ctypes.POINTER(ctypes.c_float)),
                frame_in.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
            )

            output[start:end] = frame_out

        # Scale back to -1 to 1 range
        output = output / 32767.0

        # Handle any remaining samples (append unprocessed tail)
        remaining = len(audio_scaled) % FRAME_SIZE
        if remaining > 0:
            tail = audio[-remaining:] if original_rate == RNNOISE_SAMPLE_RATE else \
                   self._resample(audio[-remaining:], original_rate, RNNOISE_SAMPLE_RATE)
            # Just use original for the short tail (less than 10ms)
            output = np.concatenate([output, audio[-remaining:] / 32767.0 if original_rate != RNNOISE_SAMPLE_RATE else audio[-remaining:]])

        # Resample back to original rate if needed
        if original_rate != RNNOISE_SAMPLE_RATE:
            output = self._resample(output, RNNOISE_SAMPLE_RATE, original_rate)

        # Normalize to prevent clipping
        max_val = np.abs(output).max()
        if max_val > 0.99:
            output = output * 0.95 / max_val

        return output.astype(np.float32)

    def _resample(self, audio: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
        """
        Resample audio using linear interpolation.

        For better quality, scipy.signal.resample could be used if available.
        """
        if from_rate == to_rate:
            return audio

        # Try scipy first for better quality
        try:
            from scipy import signal
            num_samples = int(len(audio) * to_rate / from_rate)
            return signal.resample(audio, num_samples).astype(np.float32)
        except ImportError:
            pass

        # Fallback to linear interpolation
        duration = len(audio) / from_rate
        target_len = int(duration * to_rate)
        if target_len == 0:
            return np.array([], dtype=np.float32)
        indices = np.linspace(0, len(audio) - 1, target_len)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

    def __del__(self):
        """Cleanup RNNoise state."""
        if self._lib and self._state:
            try:
                self._lib.rnnoise_destroy(self._state)
            except Exception:
                pass  # Ignore errors during cleanup


# Global instance
_rnnoise: Optional[RNNoiseProcessor] = None


def get_rnnoise() -> RNNoiseProcessor:
    """Get or create the global RNNoise processor instance."""
    global _rnnoise
    if _rnnoise is None:
        _rnnoise = RNNoiseProcessor()
    return _rnnoise


def is_rnnoise_available() -> bool:
    """Check if RNNoise library is available."""
    try:
        processor = get_rnnoise()
        return processor._load_library()
    except Exception:
        return False


def reduce_noise(
    input_path: str,
    output_path: Optional[str] = None,
    strength: float = 0.5,
    stationary: bool = True,
    sample_rate: int = 16000
) -> NoiseReductionResult:
    """
    Apply noise reduction to audio file.

    Uses RNNoise neural network-based noise suppression.

    Args:
        input_path: Path to input audio file
        output_path: Path for output (if None, creates temp file)
        strength: Reduction strength 0.0-1.0 (not used by RNNoise, kept for API compat)
        stationary: Not used by RNNoise, kept for API compatibility
        sample_rate: Target sample rate (default 16000 for Whisper)

    Returns:
        NoiseReductionResult with success status and output path
    """
    # Validate inputs
    if not os.path.exists(input_path):
        return NoiseReductionResult(
            success=False,
            output_path=input_path,
            original_path=input_path,
            error=f"Input file not found: {input_path}"
        )

    # Try to import soundfile
    try:
        import soundfile as sf
    except ImportError:
        logger.warning("soundfile not installed - skipping noise reduction")
        return NoiseReductionResult(
            success=False,
            output_path=input_path,
            original_path=input_path,
            error="soundfile not installed"
        )

    # Check if RNNoise is available
    processor = get_rnnoise()
    if not processor._load_library():
        logger.warning("RNNoise not available - skipping noise reduction")
        return NoiseReductionResult(
            success=False,
            output_path=input_path,
            original_path=input_path,
            error="RNNoise library not available"
        )

    try:
        # Load audio
        audio, sr = sf.read(input_path)

        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Ensure float32
        audio = audio.astype(np.float32)

        # Apply noise reduction
        reduced = processor.process(audio, sr)

        # Create output path if not provided
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        # Save reduced audio
        sf.write(output_path, reduced, sr)

        duration = len(reduced) / sr
        logger.info(f"RNNoise reduction applied: duration={duration:.1f}s")

        return NoiseReductionResult(
            success=True,
            output_path=output_path,
            original_path=input_path,
            sample_rate=sr,
            duration_seconds=duration
        )

    except Exception as e:
        logger.error(f"Noise reduction failed: {e}")
        return NoiseReductionResult(
            success=False,
            output_path=input_path,
            original_path=input_path,
            error=str(e)
        )


def reduce_noise_array(
    audio: np.ndarray,
    sample_rate: int = 16000,
    strength: float = 0.5,
    stationary: bool = True
) -> np.ndarray:
    """
    Apply noise reduction to audio array (in-memory processing).

    Args:
        audio: Audio samples as numpy array
        sample_rate: Sample rate of the audio
        strength: Not used by RNNoise, kept for API compatibility
        stationary: Not used by RNNoise, kept for API compatibility

    Returns:
        Noise-reduced audio array
    """
    processor = get_rnnoise()
    if not processor._load_library():
        logger.warning("RNNoise not available - returning original audio")
        return audio

    try:
        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Apply noise reduction
        return processor.process(audio.astype(np.float32), sample_rate)

    except Exception as e:
        logger.error(f"Noise reduction failed: {e}")
        return audio


def estimate_noise_level(audio_path: str) -> float:
    """
    Estimate the noise level in an audio file.

    Uses the first 0.5 seconds to estimate background noise RMS.

    Args:
        audio_path: Path to audio file

    Returns:
        Estimated noise RMS (0.0-1.0), or -1.0 on error
    """
    try:
        import soundfile as sf

        audio, sr = sf.read(audio_path)

        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Use first 0.5 seconds (or less if audio is shorter)
        noise_samples = min(int(0.5 * sr), len(audio))
        noise_segment = audio[:noise_samples]

        # Calculate RMS
        rms = np.sqrt(np.mean(noise_segment ** 2))

        return float(rms)

    except Exception as e:
        logger.error(f"Failed to estimate noise level: {e}")
        return -1.0


# Backwards compatibility alias
def is_noisereduce_available() -> bool:
    """
    Check if noise reduction is available.

    Note: This function name is kept for backwards compatibility.
    Now uses RNNoise instead of noisereduce.
    """
    return is_rnnoise_available()
