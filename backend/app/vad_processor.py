"""
Voice Activity Detection processor using Silero VAD.
Detects speech segments and filters non-speech audio.

This module provides VAD functionality to skip silent audio chunks
before sending them to Whisper, preventing hallucinations.
"""
import os
import logging
import numpy as np
from pathlib import Path
from typing import Tuple, Optional, List, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger('transcriptai.vad_processor')


@dataclass
class VADResult:
    """Result of VAD analysis."""
    has_speech: bool
    speech_ratio: float
    speech_segments: List[Tuple[float, float]]  # (start_sec, end_sec)
    total_duration: float


class VADProcessor:
    """
    Silero VAD wrapper for speech detection.

    Uses ONNX runtime for efficient inference without requiring PyTorch.
    Model is lazy-loaded on first use to minimize startup time.
    """

    def __init__(self, threshold: float = 0.3, min_speech_ratio: float = 0.1):
        """
        Initialize VAD processor.

        Args:
            threshold: Speech probability threshold (0.0-1.0). Higher = stricter.
            min_speech_ratio: Minimum ratio of speech frames to consider audio as containing speech.
        """
        self.threshold = threshold
        self.min_speech_ratio = min_speech_ratio
        self.session = None
        self._model_loaded = False
        self._h = None  # Hidden state for Silero VAD
        self._c = None  # Cell state for Silero VAD
        self._sample_rate = 16000  # Silero VAD expects 16kHz

    def _load_model(self) -> bool:
        """
        Lazy load the ONNX model.

        Returns:
            True if model loaded successfully, False otherwise.
        """
        if self._model_loaded:
            return self.session is not None

        self._model_loaded = True

        try:
            import onnxruntime as ort
            from .config import get_vad_model_path, is_vad_model_available

            if not is_vad_model_available():
                logger.warning("VAD model not available - VAD will be disabled")
                logger.warning("Download the model using: POST /api/v1/models/vad/download")
                return False

            model_path = get_vad_model_path()

            # Configure ONNX runtime for optimal performance
            sess_options = ort.SessionOptions()
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_options.intra_op_num_threads = 1  # VAD is fast, single thread is fine

            self.session = ort.InferenceSession(
                model_path,
                sess_options=sess_options,
                providers=['CPUExecutionProvider']
            )

            # Initialize hidden states for Silero VAD (required for stateful model)
            self._h = np.zeros((2, 1, 64), dtype=np.float32)
            self._c = np.zeros((2, 1, 64), dtype=np.float32)

            logger.info(f"Loaded Silero VAD model from {model_path}")
            return True

        except ImportError as e:
            logger.warning(f"onnxruntime not installed - VAD disabled: {e}")
            logger.warning("Install with: pip install onnxruntime")
            return False
        except Exception as e:
            logger.error(f"Failed to load VAD model: {e}")
            return False

    def _reset_states(self):
        """Reset hidden states for new audio processing."""
        if self._h is not None:
            self._h = np.zeros((2, 1, 64), dtype=np.float32)
            self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def _get_speech_prob(self, audio_chunk: np.ndarray) -> float:
        """
        Get speech probability for a single audio chunk.

        Args:
            audio_chunk: Audio samples (512 samples at 16kHz = 32ms)

        Returns:
            Speech probability (0.0-1.0)
        """
        if self.session is None:
            return 1.0  # Fallback: assume speech

        try:
            # Silero VAD expects shape [batch, samples]
            audio_input = audio_chunk.reshape(1, -1).astype(np.float32)

            # Get input names from model
            input_names = [inp.name for inp in self.session.get_inputs()]

            # Prepare inputs based on model version
            if len(input_names) == 4:
                # Newer Silero VAD with hidden states
                ort_inputs = {
                    input_names[0]: audio_input,
                    input_names[1]: np.array([self._sample_rate], dtype=np.int64),
                    input_names[2]: self._h,
                    input_names[3]: self._c
                }
                outputs = self.session.run(None, ort_inputs)
                prob = float(outputs[0][0])
                # Update hidden states
                if len(outputs) > 2:
                    self._h = outputs[1]
                    self._c = outputs[2]
            else:
                # Simpler model without hidden states
                ort_inputs = {input_names[0]: audio_input}
                if len(input_names) > 1:
                    ort_inputs[input_names[1]] = np.array([self._sample_rate], dtype=np.int64)
                outputs = self.session.run(None, ort_inputs)
                prob = float(outputs[0][0]) if outputs[0].size == 1 else float(outputs[0][0][0])

            return prob

        except Exception as e:
            logger.debug(f"VAD inference error: {e}")
            return 1.0  # Fallback: assume speech

    def is_speech_present(self, audio_path: str) -> bool:
        """
        Quick check if audio file contains speech.

        Args:
            audio_path: Path to audio file (should be 16kHz WAV)

        Returns:
            True if speech detected, False if silent/noise only
        """
        result = self.analyze(audio_path)
        return result.has_speech

    def analyze(self, audio_path: str) -> VADResult:
        """
        Analyze audio file for voice activity.

        Args:
            audio_path: Path to audio file

        Returns:
            VADResult with speech detection results
        """
        # Default result (assume speech present)
        default_result = VADResult(
            has_speech=True,
            speech_ratio=1.0,
            speech_segments=[],
            total_duration=0.0
        )

        if not self._load_model():
            return default_result

        try:
            import soundfile as sf

            # Load audio
            audio, sr = sf.read(audio_path)

            # Convert to mono if stereo
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)

            # Resample if not 16kHz
            if sr != self._sample_rate:
                logger.warning(f"Audio sample rate {sr} != {self._sample_rate}, resampling...")
                audio = self._resample(audio, sr, self._sample_rate)
                sr = self._sample_rate

            total_duration = len(audio) / sr

            # Reset hidden states for new audio
            self._reset_states()

            # Process in 512-sample windows (32ms at 16kHz)
            window_size = 512
            speech_frames = 0
            total_frames = 0
            speech_segments = []
            in_speech = False
            speech_start = 0.0

            for i in range(0, len(audio) - window_size, window_size):
                window = audio[i:i + window_size].astype(np.float32)
                prob = self._get_speech_prob(window)

                current_time = i / sr
                is_speech = prob > self.threshold

                total_frames += 1
                if is_speech:
                    speech_frames += 1
                    if not in_speech:
                        in_speech = True
                        speech_start = current_time
                else:
                    if in_speech:
                        in_speech = False
                        speech_segments.append((speech_start, current_time))

            # Close any open speech segment
            if in_speech:
                speech_segments.append((speech_start, total_duration))

            speech_ratio = speech_frames / max(total_frames, 1)
            has_speech = speech_ratio >= self.min_speech_ratio

            logger.debug(f"VAD analysis: speech_ratio={speech_ratio:.2%}, has_speech={has_speech}")

            return VADResult(
                has_speech=has_speech,
                speech_ratio=speech_ratio,
                speech_segments=speech_segments,
                total_duration=total_duration
            )

        except Exception as e:
            logger.error(f"VAD analysis failed: {e}")
            return default_result

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Simple resampling using linear interpolation."""
        if orig_sr == target_sr:
            return audio

        duration = len(audio) / orig_sr
        target_length = int(duration * target_sr)

        # Linear interpolation
        indices = np.linspace(0, len(audio) - 1, target_length)
        return np.interp(indices, np.arange(len(audio)), audio)

    def filter_silence(
        self,
        audio_path: str,
        output_path: Optional[str] = None,
        padding_ms: int = 100
    ) -> Tuple[str, float]:
        """
        Remove silent segments from audio file.

        Args:
            audio_path: Path to input audio file
            output_path: Path for output (creates temp file if None)
            padding_ms: Padding around speech segments in milliseconds

        Returns:
            Tuple of (output_path, speech_ratio)
        """
        result = self.analyze(audio_path)

        if not result.speech_segments:
            # No speech segments found, return original
            return audio_path, result.speech_ratio

        try:
            import soundfile as sf
            import tempfile

            audio, sr = sf.read(audio_path)
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)

            padding_samples = int(padding_ms * sr / 1000)

            # Extract speech segments with padding
            speech_audio = []
            for start_sec, end_sec in result.speech_segments:
                start_sample = max(0, int(start_sec * sr) - padding_samples)
                end_sample = min(len(audio), int(end_sec * sr) + padding_samples)
                speech_audio.append(audio[start_sample:end_sample])

            # Concatenate speech segments
            if speech_audio:
                filtered_audio = np.concatenate(speech_audio)
            else:
                filtered_audio = audio

            # Save to output path
            if output_path is None:
                fd, output_path = tempfile.mkstemp(suffix=".wav")
                os.close(fd)

            sf.write(output_path, filtered_audio, sr)

            logger.info(f"Filtered silence: {len(audio)/sr:.1f}s -> {len(filtered_audio)/sr:.1f}s")

            return output_path, result.speech_ratio

        except Exception as e:
            logger.error(f"Failed to filter silence: {e}")
            return audio_path, result.speech_ratio


# =============================================================================
# Global instance (lazy initialized)
# =============================================================================

_vad_processor: Optional[VADProcessor] = None


def get_vad_processor() -> VADProcessor:
    """
    Get or create the global VAD processor instance.

    Returns:
        VADProcessor singleton instance
    """
    global _vad_processor
    if _vad_processor is None:
        from .config import get_vad_threshold
        _vad_processor = VADProcessor(threshold=get_vad_threshold())
    return _vad_processor


def is_speech_present(audio_path: str) -> bool:
    """
    Convenience function to check if audio contains speech.

    Args:
        audio_path: Path to audio file

    Returns:
        True if speech detected
    """
    return get_vad_processor().is_speech_present(audio_path)
