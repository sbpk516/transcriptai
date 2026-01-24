"""
Unit tests for noise processor module.
Tests RNNoise-based noise suppression functionality.
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

from app.noise_processor import (
    reduce_noise,
    reduce_noise_array,
    estimate_noise_level,
    is_rnnoise_available,
    is_noisereduce_available,
    get_rnnoise,
    NoiseReductionResult,
    RNNoiseProcessor,
    FRAME_SIZE,
    RNNOISE_SAMPLE_RATE
)

# Check if RNNoise is available
RNNOISE_AVAILABLE = is_rnnoise_available()


class TestNoiseReductionResult:
    """Test NoiseReductionResult dataclass."""

    def test_success_result(self):
        """Test creating a successful result."""
        result = NoiseReductionResult(
            success=True,
            output_path="/path/to/output.wav",
            original_path="/path/to/input.wav",
            sample_rate=16000,
            duration_seconds=5.0
        )

        assert result.success is True
        assert result.output_path == "/path/to/output.wav"
        assert result.error is None

    def test_failure_result(self):
        """Test creating a failure result."""
        result = NoiseReductionResult(
            success=False,
            output_path="/path/to/input.wav",
            original_path="/path/to/input.wav",
            error="Test error"
        )

        assert result.success is False
        assert result.error == "Test error"


class TestRNNoiseProcessor:
    """Test RNNoiseProcessor class."""

    def test_processor_initialization(self):
        """Test that processor initializes correctly."""
        processor = RNNoiseProcessor()
        assert processor._lib is None
        assert processor._state is None
        assert processor._loaded is False

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_library_loading(self):
        """Test that library loads successfully."""
        processor = get_rnnoise()
        loaded = processor._load_library()
        assert loaded is True
        assert processor._lib is not None
        assert processor._state is not None

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_process_simple_audio(self):
        """Test processing a simple audio array."""
        processor = get_rnnoise()

        # Create 1 second of audio at 48kHz (native RNNoise rate)
        audio = np.random.randn(RNNOISE_SAMPLE_RATE).astype(np.float32) * 0.1

        result = processor.process(audio, RNNOISE_SAMPLE_RATE)

        assert result is not None
        assert len(result) > 0
        # Result should be similar length (within frame size difference)
        assert abs(len(result) - len(audio)) < FRAME_SIZE * 2

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_process_with_resampling(self):
        """Test processing audio that requires resampling."""
        processor = get_rnnoise()

        # Create 1 second of audio at 16kHz (requires upsampling to 48kHz)
        sr = 16000
        audio = np.random.randn(sr).astype(np.float32) * 0.1

        result = processor.process(audio, sr)

        assert result is not None
        assert len(result) > 0
        # Result should be similar length to input
        assert abs(len(result) - len(audio)) < 1000


class TestReduceNoise:
    """Test reduce_noise function."""

    def test_file_not_found(self):
        """Test handling of non-existent file."""
        result = reduce_noise("/nonexistent/path/audio.wav")

        assert result.success is False
        assert "not found" in result.error.lower()
        assert result.output_path == "/nonexistent/path/audio.wav"

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_successful_noise_reduction(self):
        """Test successful noise reduction."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            # Create audio with noise
            sr = 16000
            duration = 1.0
            t = np.linspace(0, duration, int(sr * duration))

            # Signal + noise
            signal = np.sin(2 * np.pi * 440 * t) * 0.3
            noise = np.random.randn(len(t)) * 0.1
            audio = (signal + noise).astype(np.float32)

            sf.write(temp_path, audio, sr)

            result = reduce_noise(temp_path, strength=0.5)

            assert result.success is True
            assert os.path.exists(result.output_path)
            assert result.duration_seconds > 0

            # Cleanup
            if result.output_path != temp_path:
                os.unlink(result.output_path)

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_custom_output_path(self):
        """Test specifying custom output path."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_input = f.name

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_output = f.name

        try:
            # Create test audio
            audio = np.random.randn(16000).astype(np.float32) * 0.1
            sf.write(temp_input, audio, 16000)

            result = reduce_noise(temp_input, output_path=temp_output)

            if result.success:
                assert result.output_path == temp_output

        finally:
            for p in [temp_input, temp_output]:
                if os.path.exists(p):
                    os.unlink(p)


class TestReduceNoiseArray:
    """Test reduce_noise_array function."""

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_array_noise_reduction(self):
        """Test in-memory noise reduction."""
        # Create noisy audio
        sr = 16000
        t = np.linspace(0, 1, sr)
        signal = np.sin(2 * np.pi * 440 * t) * 0.3
        noise = np.random.randn(sr) * 0.1
        audio = (signal + noise).astype(np.float32)

        result = reduce_noise_array(audio, sample_rate=sr, strength=0.5)

        assert result is not None
        assert len(result) > 0
        assert result.dtype == np.float32

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_stereo_to_mono_conversion(self):
        """Test that stereo audio is converted to mono."""
        # Create stereo audio
        sr = 16000
        audio_stereo = np.random.randn(sr, 2).astype(np.float32) * 0.1

        result = reduce_noise_array(audio_stereo, sample_rate=sr)

        # Result should be mono (1D)
        assert len(result.shape) == 1

    def test_fallback_when_unavailable(self):
        """Test that original audio is returned when RNNoise is unavailable."""
        # This test simulates unavailable library
        with patch.object(RNNoiseProcessor, '_load_library', return_value=False):
            processor = RNNoiseProcessor()
            audio = np.random.randn(16000).astype(np.float32) * 0.1
            result = processor.process(audio, 16000)
            # Should return original audio unchanged
            np.testing.assert_array_equal(result, audio)


class TestEstimateNoiseLevel:
    """Test estimate_noise_level function."""

    def test_file_not_found(self):
        """Test handling of non-existent file."""
        result = estimate_noise_level("/nonexistent/path/audio.wav")
        assert result == -1.0

    def test_silent_audio(self):
        """Test noise estimation on silent audio."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            # Create silent audio
            audio = np.zeros(16000, dtype=np.float32)
            sf.write(temp_path, audio, 16000)

            result = estimate_noise_level(temp_path)

            # Should be very low for silent audio
            assert result >= 0
            assert result < 0.01

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_noisy_audio(self):
        """Test noise estimation on noisy audio."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            # Create noisy audio (white noise)
            audio = np.random.randn(16000).astype(np.float32) * 0.5
            sf.write(temp_path, audio, 16000)

            result = estimate_noise_level(temp_path)

            # Should detect significant noise
            assert result > 0.1

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


class TestAvailabilityChecks:
    """Test availability check functions."""

    def test_is_rnnoise_available_returns_boolean(self):
        """Test that is_rnnoise_available returns boolean."""
        result = is_rnnoise_available()
        assert isinstance(result, bool)

    def test_is_noisereduce_available_returns_boolean(self):
        """Test backwards compatibility alias returns boolean."""
        result = is_noisereduce_available()
        assert isinstance(result, bool)

    def test_backwards_compatibility_alias(self):
        """Test that is_noisereduce_available is alias for is_rnnoise_available."""
        assert is_noisereduce_available() == is_rnnoise_available()


class TestResampling:
    """Test audio resampling functionality."""

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_resample_up(self):
        """Test upsampling from 16kHz to 48kHz."""
        processor = RNNoiseProcessor()
        processor._load_library()

        # 1 second at 16kHz
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 16000)).astype(np.float32)

        # Resample to 48kHz
        resampled = processor._resample(audio, 16000, 48000)

        # Should be 3x longer
        expected_len = 48000
        assert abs(len(resampled) - expected_len) < 10

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_resample_down(self):
        """Test downsampling from 48kHz to 16kHz."""
        processor = RNNoiseProcessor()
        processor._load_library()

        # 1 second at 48kHz
        audio = np.sin(np.linspace(0, 2 * np.pi * 440, 48000)).astype(np.float32)

        # Resample to 16kHz
        resampled = processor._resample(audio, 48000, 16000)

        # Should be 1/3 as long
        expected_len = 16000
        assert abs(len(resampled) - expected_len) < 10

    @pytest.mark.skipif(not RNNOISE_AVAILABLE, reason="RNNoise library not available")
    def test_resample_same_rate(self):
        """Test that same rate returns identical audio."""
        processor = RNNoiseProcessor()
        processor._load_library()

        audio = np.random.randn(16000).astype(np.float32)
        resampled = processor._resample(audio, 16000, 16000)

        np.testing.assert_array_equal(resampled, audio)


class TestConstants:
    """Test module constants."""

    def test_frame_size(self):
        """Test FRAME_SIZE constant."""
        assert FRAME_SIZE == 480  # 10ms at 48kHz

    def test_rnnoise_sample_rate(self):
        """Test RNNOISE_SAMPLE_RATE constant."""
        assert RNNOISE_SAMPLE_RATE == 48000


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
