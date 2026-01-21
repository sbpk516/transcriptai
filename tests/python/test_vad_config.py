"""Tests for VAD configuration functions in config.py."""

import importlib
import os
from pathlib import Path

import pytest


class TestIsVADEnabled:
    """Test is_vad_enabled() function."""

    def test_vad_enabled_by_default(self, monkeypatch):
        """VAD should be enabled by default when env var not set."""
        monkeypatch.delenv("TRANSCRIPTAI_VAD_ENABLED", raising=False)
        from backend.app import config
        importlib.reload(config)
        assert config.is_vad_enabled() is True

    def test_vad_disabled_when_zero(self, monkeypatch):
        """VAD should be disabled when env var is '0'."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_ENABLED", "0")
        from backend.app import config
        importlib.reload(config)
        assert config.is_vad_enabled() is False

    def test_vad_enabled_when_one(self, monkeypatch):
        """VAD should be enabled when env var is '1'."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_ENABLED", "1")
        from backend.app import config
        importlib.reload(config)
        assert config.is_vad_enabled() is True

    def test_vad_enabled_for_other_values(self, monkeypatch):
        """VAD should remain enabled for any value other than '0'."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_ENABLED", "true")
        from backend.app import config
        importlib.reload(config)
        assert config.is_vad_enabled() is True


class TestGetVADThreshold:
    """Test get_vad_threshold() function."""

    def test_default_threshold_is_half(self, monkeypatch):
        """Default VAD threshold should be 0.5."""
        monkeypatch.delenv("TRANSCRIPTAI_VAD_THRESHOLD", raising=False)
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 0.5

    def test_custom_threshold(self, monkeypatch):
        """Custom threshold from env var should be returned."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_THRESHOLD", "0.7")
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 0.7

    def test_threshold_at_zero(self, monkeypatch):
        """Threshold of 0.0 should be valid."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_THRESHOLD", "0.0")
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 0.0

    def test_threshold_at_one(self, monkeypatch):
        """Threshold of 1.0 should be valid."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_THRESHOLD", "1.0")
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 1.0

    def test_invalid_threshold_falls_back_to_default(self, monkeypatch):
        """Invalid threshold value should fall back to 0.5."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_THRESHOLD", "invalid")
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 0.5

    def test_empty_threshold_falls_back_to_default(self, monkeypatch):
        """Empty threshold value should fall back to 0.5."""
        monkeypatch.setenv("TRANSCRIPTAI_VAD_THRESHOLD", "")
        from backend.app import config
        importlib.reload(config)
        assert config.get_vad_threshold() == 0.5


class TestGetVADModelPath:
    """Test get_vad_model_path() function."""

    def test_returns_none_when_model_not_found(self, monkeypatch, tmp_path):
        """Should return None when VAD model doesn't exist anywhere."""
        # Point to empty directories
        monkeypatch.setenv("TRANSCRIPTAI_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR", raising=False)

        from backend.app import config
        importlib.reload(config)

        result = config.get_vad_model_path()
        assert result is None

    def test_finds_model_in_user_dir(self, monkeypatch, tmp_path):
        """Should find VAD model in user models directory."""
        # Create fake model file in user dir
        models_dir = tmp_path / "models"
        models_dir.mkdir()
        vad_model = models_dir / "silero-vad.onnx"
        vad_model.write_bytes(b"fake vad model data")

        monkeypatch.setenv("TRANSCRIPTAI_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR", raising=False)

        from backend.app import config
        importlib.reload(config)

        result = config.get_vad_model_path()
        assert result is not None
        assert result.name == "silero-vad.onnx"
        assert result.exists()

    def test_bundled_dir_takes_priority(self, monkeypatch, tmp_path):
        """Bundled models directory should take priority over user dir."""
        # Create model in both bundled and user dirs
        bundled_dir = tmp_path / "bundled"
        bundled_dir.mkdir()
        bundled_model = bundled_dir / "silero-vad.onnx"
        bundled_model.write_bytes(b"bundled model")

        user_dir = tmp_path / "user"
        user_models = user_dir / "models"
        user_models.mkdir(parents=True)
        user_model = user_models / "silero-vad.onnx"
        user_model.write_bytes(b"user model")

        monkeypatch.setenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR", str(bundled_dir))
        monkeypatch.setenv("TRANSCRIPTAI_DATA_DIR", str(user_dir))

        from backend.app import config
        importlib.reload(config)

        result = config.get_vad_model_path()
        assert result is not None
        assert str(bundled_dir) in str(result)


class TestIsVADModelAvailable:
    """Test is_vad_model_available() function."""

    def test_returns_false_when_model_missing(self, monkeypatch, tmp_path):
        """Should return False when VAD model is not available."""
        monkeypatch.setenv("TRANSCRIPTAI_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR", raising=False)

        from backend.app import config
        importlib.reload(config)

        assert config.is_vad_model_available() is False

    def test_returns_true_when_model_exists(self, monkeypatch, tmp_path):
        """Should return True when VAD model is available."""
        models_dir = tmp_path / "models"
        models_dir.mkdir()
        vad_model = models_dir / "silero-vad.onnx"
        vad_model.write_bytes(b"fake vad model")

        monkeypatch.setenv("TRANSCRIPTAI_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR", raising=False)

        from backend.app import config
        importlib.reload(config)

        assert config.is_vad_model_available() is True
