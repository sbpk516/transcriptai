import json
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Tuple

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.api import models as models_module
from backend.app import whisper_backend_selector as selector_module


class DummyProcessor:
    """
    Lightweight stand-in for WhisperProcessor/WhisperProcessorMLX used in tests.
    Simulates caching behaviour without performing real downloads.
    """

    def __init__(self, delay: float = 0.05):
        self.model_name = "tiny"
        self._available = ["tiny", "base", "small"]
        self._cached = {"tiny"}
        self.delay = delay
        self.auto_complete = True
        self._pending_events: Dict[str, threading.Event] = {}
        self.download_history: List[str] = []
        self.reload_history: List[str] = []

    # API surface mimicking the production processors ---------------------------------
    def get_available_models(self) -> List[str]:
        return list(self._available)

    def is_model_cached(self, model_name: str) -> bool:
        return model_name in self._cached

    def download_model(self, model_name: str) -> bool:
        self.download_history.append(model_name)
        if self.auto_complete:
            time.sleep(self.delay)
        else:
            event = threading.Event()
            self._pending_events[model_name] = event
            event.wait()
            self._pending_events.pop(model_name, None)
        self._cached.add(model_name)
        return True

    def reload_model(self, model_name: str) -> bool:
        if model_name not in self._cached:
            raise RuntimeError("model must be cached before reload")
        self.model_name = model_name
        self.reload_history.append(model_name)
        return True

    def allow_completion(self, model_name: str) -> None:
        event = self._pending_events.get(model_name)
        if event:
            event.set()


@pytest.fixture()
def models_client(tmp_path, monkeypatch) -> Tuple[TestClient, DummyProcessor]:
    """
    Provide a TestClient bound to the models router with a dummy processor.
    """
    dummy = DummyProcessor()

    # Ensure job state and preference files live under the temporary directory.
    job_state_path = tmp_path / "model_jobs.json"
    preference_path = tmp_path / "model_preference.json"

    monkeypatch.setattr(models_module, "_job_state_path", lambda: job_state_path)
    monkeypatch.setattr(selector_module, "get_model_preference_path", lambda: preference_path)
    monkeypatch.setattr(models_module, "get_global_whisper_processor", lambda: dummy)

    # Reset synchronization primitives for a clean slate per test.
    models_module._JOB_LOCKS.clear()
    models_module._GLOBAL_DOWNLOADS = threading.Semaphore(2)

    app = FastAPI()
    app.include_router(models_module.router, prefix="/api/v1")
    return TestClient(app), dummy


def _status_for(models: List[Dict[str, object]], name: str) -> Dict[str, object]:
    for entry in models:
        if entry["name"] == name:
            return entry
    raise AssertionError(f"Model {name} not found in payload")


def _wait_for_status(client: TestClient, name: str, expected: str, *, timeout: float = 2.0) -> Dict[str, object]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        payload = client.get("/api/v1/models").json()
        entry = _status_for(payload, name)
        if entry["status"] == expected:
            return entry
        time.sleep(0.05)
    pytest.fail(f"Timed out waiting for status '{expected}' on model '{name}'")


def test_download_transitions_from_downloading_to_downloaded(models_client):
    client, dummy = models_client

    initial_payload = client.get("/api/v1/models").json()
    assert _status_for(initial_payload, "tiny")["status"] == "downloaded"
    assert _status_for(initial_payload, "base")["status"] == "idle"

    dummy.auto_complete = False
    resp = client.post("/api/v1/models/download", json={"name": "base"})
    assert resp.status_code == 200, resp.text

    # Immediately after triggering the download the state should flip to downloading.
    immediate = client.get("/api/v1/models").json()
    assert _status_for(immediate, "base")["status"] == "downloading"

    # Once the simulated download finishes the status must become downloaded.
    dummy.allow_completion("base")
    final_entry = _wait_for_status(client, "base", "downloaded")
    assert final_entry["is_downloaded"] is True
    assert "error" not in (final_entry.get("message") or "").lower()
    assert dummy.download_history == ["base"]


def test_download_persists_across_polling_and_navigation(models_client):
    client, dummy = models_client
    dummy.auto_complete = False

    client.post("/api/v1/models/download", json={"name": "small"})
    # Poll several times while download is in-flight to mimic user navigation.
    for _ in range(3):
        payload = client.get("/api/v1/models").json()
        assert _status_for(payload, "small")["status"] == "downloading"
        time.sleep(0.05)

    # Eventually the job completes and the status should update automatically.
    dummy.allow_completion("small")
    _wait_for_status(client, "small", "downloaded")
    assert dummy.download_history == ["small"]


def test_multiple_downloads_and_selection(models_client):
    client, dummy = models_client

    # Download base model then select it.
    client.post("/api/v1/models/download", json={"name": "base"})
    _wait_for_status(client, "base", "downloaded")

    select_resp = client.post("/api/v1/models/select", json={"name": "base"})
    assert select_resp.status_code == 200, select_resp.text
    assert dummy.reload_history == ["base"]
    assert dummy.model_name == "base"

    # Download another model and ensure both appear as downloaded.
    client.post("/api/v1/models/download", json={"name": "small"})
    _wait_for_status(client, "small", "downloaded")

    payload = client.get("/api/v1/models").json()
    assert _status_for(payload, "base")["status"] == "downloaded"
    assert _status_for(payload, "small")["status"] == "downloaded"

    # Users should be able to switch between any downloaded model.
    select_small = client.post("/api/v1/models/select", json={"name": "small"})
    assert select_small.status_code == 200, select_small.text
    assert dummy.reload_history[-1] == "small"
    assert dummy.model_name == "small"

