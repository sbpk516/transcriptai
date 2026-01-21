"""Tests for VAD model API endpoints."""

import importlib
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


class TestVADStatusEndpoint:
    """Test GET /api/v1/models/vad endpoint."""

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_returns_all_fields(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """VAD status endpoint should return all required fields."""
        mock_enabled.return_value = True
        mock_available.return_value = True
        mock_path.return_value = Path("/path/to/silero-vad.onnx")
        mock_threshold.return_value = 0.5

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert "model_available" in data
        assert "model_path" in data
        assert "threshold" in data

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_enabled_true(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """Should return enabled=True when VAD is enabled."""
        mock_enabled.return_value = True
        mock_available.return_value = False
        mock_path.return_value = None
        mock_threshold.return_value = 0.5

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is True

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_disabled(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """Should return enabled=False when VAD is disabled."""
        mock_enabled.return_value = False
        mock_available.return_value = False
        mock_path.return_value = None
        mock_threshold.return_value = 0.5

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_model_available(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """Should return model_available=True when model exists."""
        mock_enabled.return_value = True
        mock_available.return_value = True
        mock_path.return_value = Path("/models/silero-vad.onnx")
        mock_threshold.return_value = 0.5

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert data["model_available"] is True
        assert data["model_path"] is not None

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_model_not_available(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """Should return model_available=False when model missing."""
        mock_enabled.return_value = True
        mock_available.return_value = False
        mock_path.return_value = None
        mock_threshold.return_value = 0.5

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert data["model_available"] is False
        assert data["model_path"] is None

    @patch("backend.app.api.models.is_vad_enabled")
    @patch("backend.app.api.models.is_vad_model_available")
    @patch("backend.app.api.models.get_vad_model_path")
    @patch("backend.app.api.models.get_vad_threshold")
    def test_vad_status_custom_threshold(
        self, mock_threshold, mock_path, mock_available, mock_enabled
    ):
        """Should return custom threshold value."""
        mock_enabled.return_value = True
        mock_available.return_value = False
        mock_path.return_value = None
        mock_threshold.return_value = 0.8

        response = client.get("/api/v1/models/vad")

        assert response.status_code == 200
        data = response.json()
        assert data["threshold"] == 0.8


class TestVADDownloadEndpoint:
    """Test POST /api/v1/models/vad/download endpoint."""

    @patch("backend.app.api.models.get_user_models_dir")
    @patch("backend.app.api.models._download_model_file")
    def test_vad_download_starts_successfully(self, mock_download, mock_dir, tmp_path):
        """Download endpoint should start background download."""
        mock_dir.return_value = tmp_path
        mock_download.return_value = True

        response = client.post("/api/v1/models/vad/download")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    @patch("backend.app.api.models.is_vad_model_available")
    def test_vad_download_skips_if_already_downloaded(self, mock_available):
        """Should skip download if model already exists."""
        mock_available.return_value = True

        response = client.post("/api/v1/models/vad/download")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "already_downloaded"
