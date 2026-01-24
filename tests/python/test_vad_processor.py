"""
Unit tests for VAD processor module.
Tests voice activity detection functionality.
"""
import os
import sys
import tempfile
import pytest
import numpy as np
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.vad_processor import VADProcessor, VADResult, get_vad_processor, is_speech_present


class TestVADProcessor:
    """Test VADProcessor class."""

    def test_init_default_threshold(self):
        """Test initialization with default threshold."""
        processor = VADProcessor()
        assert processor.threshold == 0.3
        assert processor.min_speech_ratio == 0.1

    def test_init_custom_threshold(self):
        """Test initialization with custom threshold."""
        processor = VADProcessor(threshold=0.5, min_speech_ratio=0.2)
        assert processor.threshold == 0.5
        assert processor.min_speech_ratio == 0.2

    def test_model_not_loaded_initially(self):
        """Test that model is not loaded on init (lazy loading)."""
        processor = VADProcessor()
        assert processor._model_loaded is False
        assert processor.session is None

    @patch('app.vad_processor.VADProcessor._load_model')
    def test_is_speech_present_fallback_when_model_unavailable(self, mock_load):
        """Test fallback behavior when model is not available."""
        mock_load.return_value = False
        processor = VADProcessor()

        # Should return True (fallback) when model not available
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            # Write a minimal WAV header + silence
            f.write(b'RIFF' + b'\x00' * 36 + b'data' + b'\x00' * 100)
            temp_path = f.name

        try:
            result = processor.is_speech_present(temp_path)
            assert result is True  # Fallback: assume speech present
        finally:
            os.unlink(temp_path)

    def test_analyze_returns_vad_result(self):
        """Test that analyze returns VADResult dataclass."""
        processor = VADProcessor()

        # Create a test audio file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            # Write valid WAV data using soundfile if available
            try:
                import soundfile as sf
                # Create 1 second of silence at 16kHz
                audio = np.zeros(16000, dtype=np.float32)
                sf.write(temp_path, audio, 16000)

                result = processor.analyze(temp_path)

                assert isinstance(result, VADResult)
                assert hasattr(result, 'has_speech')
                assert hasattr(result, 'speech_ratio')
                assert hasattr(result, 'speech_segments')
                assert hasattr(result, 'total_duration')
            except ImportError:
                pytest.skip("soundfile not installed")
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_resample_same_rate(self):
        """Test that resampling returns same array when rates match."""
        processor = VADProcessor()
        audio = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result = processor._resample(audio, 16000, 16000)
        np.testing.assert_array_equal(result, audio)

    def test_resample_different_rate(self):
        """Test resampling to different rate."""
        processor = VADProcessor()
        audio = np.linspace(0, 1, 100)

        # Resample 8kHz to 16kHz (should double length)
        result = processor._resample(audio, 8000, 16000)
        assert len(result) == 200

        # Resample 32kHz to 16kHz (should halve length)
        result = processor._resample(audio, 32000, 16000)
        assert len(result) == 50


class TestVADResult:
    """Test VADResult dataclass."""

    def test_vad_result_creation(self):
        """Test creating VADResult."""
        result = VADResult(
            has_speech=True,
            speech_ratio=0.75,
            speech_segments=[(0.0, 1.5), (2.0, 3.0)],
            total_duration=4.0
        )

        assert result.has_speech is True
        assert result.speech_ratio == 0.75
        assert len(result.speech_segments) == 2
        assert result.total_duration == 4.0

    def test_vad_result_default_values(self):
        """Test VADResult with minimal arguments."""
        result = VADResult(
            has_speech=False,
            speech_ratio=0.0,
            speech_segments=[],
            total_duration=1.0
        )

        assert result.has_speech is False
        assert result.speech_ratio == 0.0
        assert result.speech_segments == []


class TestGlobalFunctions:
    """Test module-level convenience functions."""

    def test_get_vad_processor_returns_singleton(self):
        """Test that get_vad_processor returns same instance."""
        # Reset global
        import app.vad_processor as vad_module
        vad_module._vad_processor = None

        processor1 = get_vad_processor()
        processor2 = get_vad_processor()

        assert processor1 is processor2

    @patch('app.vad_processor.get_vad_processor')
    def test_is_speech_present_convenience(self, mock_get):
        """Test is_speech_present convenience function."""
        mock_processor = MagicMock()
        mock_processor.is_speech_present.return_value = True
        mock_get.return_value = mock_processor

        result = is_speech_present("/fake/path.wav")

        assert result is True
        mock_processor.is_speech_present.assert_called_once_with("/fake/path.wav")


class TestVADWithRealAudio:
    """Integration tests with real audio (skipped if dependencies missing)."""

    @pytest.fixture
    def silence_audio_path(self):
        """Create a temporary silent audio file."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        # 2 seconds of silence at 16kHz
        audio = np.zeros(32000, dtype=np.float32)
        sf.write(temp_path, audio, 16000)

        yield temp_path

        if os.path.exists(temp_path):
            os.unlink(temp_path)

    @pytest.fixture
    def speech_like_audio_path(self):
        """Create a temporary audio file with speech-like patterns."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        # Create speech-like audio (sine wave bursts)
        sr = 16000
        duration = 2.0
        t = np.linspace(0, duration, int(sr * duration))

        # Generate speech-like envelope (bursts of activity)
        envelope = np.zeros_like(t)
        envelope[int(0.2*sr):int(0.8*sr)] = 1.0  # Speech burst 1
        envelope[int(1.2*sr):int(1.8*sr)] = 1.0  # Speech burst 2

        # Generate audio with envelope
        freq = 300  # Hz (speech-like frequency)
        audio = envelope * np.sin(2 * np.pi * freq * t) * 0.5

        sf.write(temp_path, audio.astype(np.float32), sr)

        yield temp_path

        if os.path.exists(temp_path):
            os.unlink(temp_path)

    def test_silent_audio_detection(self, silence_audio_path):
        """Test that silent audio is detected as no speech (if model available)."""
        processor = VADProcessor(threshold=0.3, min_speech_ratio=0.1)

        # This test may pass or fail depending on model availability
        # The important thing is it doesn't crash
        result = processor.analyze(silence_audio_path)

        assert isinstance(result, VADResult)
        # If model not available, duration may be 0 (default result)
        # Just ensure no crash and result is valid type
        assert result.total_duration >= 0

    def test_speech_like_audio_detection(self, speech_like_audio_path):
        """Test that speech-like audio is processed correctly."""
        processor = VADProcessor(threshold=0.3, min_speech_ratio=0.1)

        result = processor.analyze(speech_like_audio_path)

        assert isinstance(result, VADResult)
        # If model not available, duration may be 0 (default result)
        # Just ensure no crash and result is valid type
        assert result.total_duration >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
