"""Tests covering background warm-up wiring in backend.app.main."""

import asyncio
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_run_startup_warmup_invokes_models(monkeypatch):
    from backend.app import main as app_mod

    calls = {}

    def fake_whisper_ensure(timeout=None, *, background=False):
        calls["whisper"] = background
        return True

    async def fake_nlp_ensure(timeout=None, *, background=False):
        calls.setdefault("nlp", []).append(background)
        return True

    monkeypatch.setattr(app_mod, "whisper_processor", SimpleNamespace(ensure_loaded=fake_whisper_ensure))
    monkeypatch.setattr(app_mod, "nlp_processor", SimpleNamespace(ensure_loaded=fake_nlp_ensure))

    await app_mod._run_startup_warmup()

    assert calls["whisper"] is True
    assert calls["nlp"] == [True]


@pytest.mark.asyncio
async def test_startup_event_schedules_warmup_task(monkeypatch):
    from backend.app import main as app_mod

    async def warmup_stub():  # pragma: no cover - invoked asynchronously
        warmup_stub.invoked = True

    warmup_stub.invoked = False

    monkeypatch.setattr(app_mod, "_run_startup_warmup", warmup_stub)
    monkeypatch.setattr(app_mod, "create_tables", lambda: None)
    monkeypatch.setattr(app_mod, "get_database_url", lambda: "sqlite:///signalhub.db")
    monkeypatch.setattr(app_mod, "is_live_transcription_enabled", lambda: False)
    monkeypatch.setattr(app_mod, "is_live_mic_enabled", lambda: False)
    monkeypatch.setattr(app_mod, "is_live_batch_only", lambda: True)

    await app_mod.startup_event()
    await asyncio.sleep(0)

    assert app_mod._warmup_task is not None
    assert warmup_stub.invoked is True

    # Cleanup to avoid interfering with other tests
    await app_mod.shutdown_event()


@pytest.mark.asyncio
async def test_shutdown_event_cancels_inflight_warmup():
    from backend.app import main as app_mod

    async def pending():
        await asyncio.sleep(10)

    task = asyncio.create_task(pending())
    app_mod._warmup_task = task

    await app_mod.shutdown_event()

    assert task.cancelled()
    assert app_mod._warmup_task is None


@pytest.mark.asyncio
async def test_health_includes_model_status(monkeypatch):
    from backend.app import main as app_mod

    class FakeConnection:
        def execute(self, _query):
            return None

        def close(self):
            return None

    def fake_get_db():
        yield FakeConnection()

    monkeypatch.setattr(app_mod, "get_db", fake_get_db)
    monkeypatch.setattr(app_mod.whisper_processor, "get_status", lambda: {"status": "ready"})
    monkeypatch.setattr(app_mod.nlp_processor, "get_status", lambda: {"status": "loading"})

    result = await app_mod.health_check()

    assert result["models"]["whisper"]["status"] == "ready"
    assert result["models"]["nlp"]["status"] == "loading"
