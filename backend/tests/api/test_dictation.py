import base64
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.main import app

client = TestClient(app)


def _fake_helper(text="hello world", confidence=0.9, duration_ms=1000):
    return {
        "text": text,
        "confidence": confidence,
        "duration_ms": duration_ms,
    }


def _sample_audio_base64():
    return base64.b64encode(b"fakeaudio").decode('ascii')


@patch("backend.app.whisper_processor.whisper_processor.transcribe_snippet_from_base64")
def test_transcribe_success(mock_helper):
    mock_helper.return_value = _fake_helper()

    response = client.post(
        "/api/v1/dictation/transcribe",
        json={
            "audio_base64": _sample_audio_base64(),
            "media_type": "audio/wav",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["text"] == "hello world"
    assert payload["confidence"] == 0.9
    assert payload["duration_ms"] == 1000
    mock_helper.assert_called_once()


def test_transcribe_unsupported_media_type():
    response = client.post(
        "/api/v1/dictation/transcribe",
        json={
            "audio_base64": _sample_audio_base64(),
            "media_type": "audio/flac",
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert "Unsupported media_type" in payload["detail"]


@patch("backend.app.whisper_processor.whisper_processor.transcribe_snippet_from_base64")
def test_transcribe_validation_error(mock_helper):
    mock_helper.side_effect = ValueError("audio snippet duration exceeds limit")

    response = client.post(
        "/api/v1/dictation/transcribe",
        json={
            "audio_base64": _sample_audio_base64(),
            "media_type": "audio/wav",
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert "duration" in payload["detail"]


@patch("backend.app.whisper_processor.whisper_processor.transcribe_snippet_from_base64")
def test_transcribe_server_error(mock_helper):
    mock_helper.side_effect = RuntimeError("whisper failure")

    response = client.post(
        "/api/v1/dictation/transcribe",
        json={
            "audio_base64": _sample_audio_base64(),
            "media_type": "audio/wav",
        },
    )

    assert response.status_code == 500
    payload = response.json()
    assert payload["detail"] == "whisper failure"
