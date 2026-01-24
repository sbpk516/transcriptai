"""
Unit tests for audio enhancer module.
Tests unified audio enhancement pipeline.
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

from app.audio_enhancer import (
    AudioEnhancer,
    EnhancementResult,
    get_audio_enhancer,
    enhance_audio,
    should_skip_chunk
)


class TestEnhancementResult:
    """Test EnhancementResult dataclass."""

    def test_default_values(self):
        """Test default values for EnhancementResult."""
        result = EnhancementResult(
            original_path="/path/to/input.wav",
            enhanced_path="/path/to/output.wav"
        )

        assert result.original_path == "/path/to/input.wav"
        assert result.enhanced_path == "/path/to/output.wav"
        assert result.noise_reduced is False
        assert result.vad_applied is False
        assert result.speech_detected is True
        assert result.speech_ratio == 1.0
        assert result.should_skip is False
        assert result.error is None

    def test_success_property(self):
        """Test success property."""
        result = EnhancementResult(
            original_path="/path/to/input.wav",
            enhanced_path="/path/to/output.wav"
        )
        assert result.success is True

        result_with_error = EnhancementResult(
            original_path="/path/to/input.wav",
            enhanced_path="/path/to/input.wav",
            error="Test error"
        )
        assert result_with_error.success is False

    def test_metadata(self):
        """Test metadata dictionary."""
        result = EnhancementResult(
            original_path="/path/to/input.wav",
            enhanced_path="/path/to/output.wav",
            metadata={"key": "value"}
        )

        assert "key" in result.metadata
        assert result.metadata["key"] == "value"


class TestAudioEnhancer:
    """Test AudioEnhancer class."""

    def test_initialization(self):
        """Test AudioEnhancer initialization."""
        enhancer = AudioEnhancer()
        assert enhancer._vad_processor is None
        assert enhancer._initialized is False

    def test_enhance_file_not_found(self):
        """Test enhancement with non-existent file."""
        enhancer = AudioEnhancer()
        result = enhancer.enhance("/nonexistent/path/audio.wav")

        assert result.error is not None
        assert "not found" in result.error.lower()

    def test_enhance_both_disabled(self):
        """Test enhancement when both features are disabled via params."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
            f.write(b'\x00' * 100)  # Write some bytes

        try:
            enhancer = AudioEnhancer()
            # Explicitly disable both features via parameters
            result = enhancer.enhance(temp_path, apply_noise_reduction=False, apply_vad=False)

            # Should return original path with no modifications
            assert result.enhanced_path == temp_path
            assert result.noise_reduced is False
            assert result.vad_applied is False

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_enhance_with_noise_reduction(self):
        """Test enhancement with noise reduction enabled."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            # Create test audio
            audio = np.random.randn(16000).astype(np.float32) * 0.1
            sf.write(temp_path, audio, 16000)

            enhancer = AudioEnhancer()
            # Explicitly enable noise reduction, disable VAD
            result = enhancer.enhance(temp_path, apply_noise_reduction=True, apply_vad=False)

            # Result depends on noisereduce availability
            assert result.original_path == temp_path
            assert result.error is None

            # Cleanup
            if result.enhanced_path != temp_path and os.path.exists(result.enhanced_path):
                os.unlink(result.enhanced_path)

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_should_skip_chunk_vad_disabled(self):
        """Test should_skip_chunk when VAD is disabled via env."""
        import os
        # Temporarily disable VAD
        old_val = os.environ.get("TRANSCRIPTAI_VAD_ENABLED")
        os.environ["TRANSCRIPTAI_VAD_ENABLED"] = "0"

        try:
            enhancer = AudioEnhancer()
            result = enhancer.should_skip_chunk("/fake/path.wav")

            assert result is False  # Should not skip when VAD disabled
        finally:
            if old_val is not None:
                os.environ["TRANSCRIPTAI_VAD_ENABLED"] = old_val
            else:
                os.environ.pop("TRANSCRIPTAI_VAD_ENABLED", None)

    def test_should_skip_chunk_vad_enabled_error(self):
        """Test should_skip_chunk handles errors gracefully."""
        import os
        # Enable VAD
        old_val = os.environ.get("TRANSCRIPTAI_VAD_ENABLED")
        os.environ["TRANSCRIPTAI_VAD_ENABLED"] = "1"

        try:
            enhancer = AudioEnhancer()
            enhancer._vad_processor = MagicMock()
            enhancer._vad_processor.is_speech_present.side_effect = Exception("Test error")

            result = enhancer.should_skip_chunk("/fake/path.wav")

            # Should return False (don't skip) on error
            assert result is False
        finally:
            if old_val is not None:
                os.environ["TRANSCRIPTAI_VAD_ENABLED"] = old_val
            else:
                os.environ.pop("TRANSCRIPTAI_VAD_ENABLED", None)

    def test_get_status(self):
        """Test get_status method."""
        enhancer = AudioEnhancer()
        status = enhancer.get_status()

        assert "vad" in status
        assert "noise_suppression" in status
        assert "enabled" in status["vad"]
        assert "available" in status["vad"]
        assert "enabled" in status["noise_suppression"]
        assert "available" in status["noise_suppression"]


class TestGlobalFunctions:
    """Test module-level convenience functions."""

    def test_get_audio_enhancer_singleton(self):
        """Test that get_audio_enhancer returns singleton."""
        import app.audio_enhancer as module
        module._audio_enhancer = None  # Reset

        enhancer1 = get_audio_enhancer()
        enhancer2 = get_audio_enhancer()

        assert enhancer1 is enhancer2

    @patch('app.audio_enhancer.get_audio_enhancer')
    def test_enhance_audio_convenience(self, mock_get):
        """Test enhance_audio convenience function."""
        mock_enhancer = MagicMock()
        mock_result = EnhancementResult(
            original_path="/input.wav",
            enhanced_path="/output.wav"
        )
        mock_enhancer.enhance.return_value = mock_result
        mock_get.return_value = mock_enhancer

        result = enhance_audio("/input.wav")

        assert result == mock_result
        mock_enhancer.enhance.assert_called_once_with("/input.wav")

    @patch('app.audio_enhancer.get_audio_enhancer')
    def test_should_skip_chunk_convenience(self, mock_get):
        """Test should_skip_chunk convenience function."""
        mock_enhancer = MagicMock()
        mock_enhancer.should_skip_chunk.return_value = True
        mock_get.return_value = mock_enhancer

        result = should_skip_chunk("/path.wav")

        assert result is True
        mock_enhancer.should_skip_chunk.assert_called_once_with("/path.wav")


class TestEnhanceForLive:
    """Test enhance_for_live method."""

    def test_enhance_for_live_skip_silent(self):
        """Test enhance_for_live skips silent audio when VAD detects no speech."""
        enhancer = AudioEnhancer()

        # Mock VAD processor to return no speech
        mock_vad_processor = MagicMock()
        mock_vad_result = MagicMock()
        mock_vad_result.has_speech = False
        mock_vad_result.speech_ratio = 0.0
        mock_vad_result.speech_segments = []
        mock_vad_result.total_duration = 1.0
        mock_vad_processor.analyze.return_value = mock_vad_result
        enhancer._vad_processor = mock_vad_processor

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
            f.write(b'\x00' * 100)

        try:
            import os as os_module
            # Enable VAD for this test
            old_val = os_module.environ.get("TRANSCRIPTAI_VAD_ENABLED")
            os_module.environ["TRANSCRIPTAI_VAD_ENABLED"] = "1"
            os_module.environ["TRANSCRIPTAI_NOISE_ENABLED"] = "0"

            try:
                result = enhancer.enhance_for_live(temp_path, skip_if_silent=True)
                # Should return None for silent audio
                assert result is None
            finally:
                if old_val is not None:
                    os_module.environ["TRANSCRIPTAI_VAD_ENABLED"] = old_val
                else:
                    os_module.environ.pop("TRANSCRIPTAI_VAD_ENABLED", None)
                os_module.environ.pop("TRANSCRIPTAI_NOISE_ENABLED", None)

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_enhance_for_live_no_skip(self):
        """Test enhance_for_live returns path when features disabled."""
        enhancer = AudioEnhancer()

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
            f.write(b'\x00' * 100)

        try:
            import os as os_module
            # Disable both features
            old_vad = os_module.environ.get("TRANSCRIPTAI_VAD_ENABLED")
            old_noise = os_module.environ.get("TRANSCRIPTAI_NOISE_ENABLED")
            os_module.environ["TRANSCRIPTAI_VAD_ENABLED"] = "0"
            os_module.environ["TRANSCRIPTAI_NOISE_ENABLED"] = "0"

            try:
                result = enhancer.enhance_for_live(temp_path, skip_if_silent=True)
                # Should return path when features disabled
                assert result == temp_path
            finally:
                if old_vad is not None:
                    os_module.environ["TRANSCRIPTAI_VAD_ENABLED"] = old_vad
                else:
                    os_module.environ.pop("TRANSCRIPTAI_VAD_ENABLED", None)
                if old_noise is not None:
                    os_module.environ["TRANSCRIPTAI_NOISE_ENABLED"] = old_noise
                else:
                    os_module.environ.pop("TRANSCRIPTAI_NOISE_ENABLED", None)

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


class TestConfigOverrides:
    """Test parameter overrides in enhance method."""

    def test_override_noise_reduction(self):
        """Test overriding noise reduction setting."""
        try:
            import soundfile as sf
        except ImportError:
            pytest.skip("soundfile not installed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name

        try:
            audio = np.random.randn(16000).astype(np.float32) * 0.1
            sf.write(temp_path, audio, 16000)

            enhancer = AudioEnhancer()

            # Force noise reduction off
            result = enhancer.enhance(
                temp_path,
                apply_noise_reduction=False,
                apply_vad=False
            )

            assert result.noise_reduced is False

            # Cleanup
            if result.enhanced_path != temp_path and os.path.exists(result.enhanced_path):
                os.unlink(result.enhanced_path)

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_override_vad(self):
        """Test overriding VAD setting."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
            f.write(b'\x00' * 100)

        try:
            enhancer = AudioEnhancer()

            # Force VAD off
            result = enhancer.enhance(
                temp_path,
                apply_noise_reduction=False,
                apply_vad=False
            )

            assert result.vad_applied is False

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
