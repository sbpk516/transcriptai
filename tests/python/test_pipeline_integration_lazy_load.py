"""Integration-style tests for lazy-load helpers within pipeline orchestrator and API endpoints."""

import asyncio
import os
import tempfile
from pathlib import Path
from types import MethodType, SimpleNamespace

import pytest


class _StubWhisperProcessor:
    def __init__(self):
        self.model_name = "stub"
        self.device = "cpu"
        self._loaded = False
        self.load_attempts = 0

    def ensure_loaded(self, timeout=None, *, background=False):  # noqa: D401
        if not self._loaded:
            self._loaded = True
            self.load_attempts += 1
            return True
        return False

    def transcribe_audio(self, wav_path):  # noqa: D401
        return {
            "transcription_success": True,
            "text": f"stub transcript for {wav_path}",
            "language": "en",
        }

    def transcribe_in_chunks(self, *_args, **_kwargs):  # pragma: no cover - unused in tests
        yield {
            "chunk_index": 0,
            "text": "stub chunk",
        }

    def save_transcript(self, call_id, result):  # noqa: D401
        return {
            "transcript_path": f"/tmp/{call_id}.json",
            "save_success": True,
            "result": result,
        }


class _StubNLPProcessor:
    def __init__(self):
        self._loaded = False
        self.load_attempts = 0

    async def ensure_loaded(self, timeout=None, *, background=False):  # noqa: D401
        if not self._loaded:
            self._loaded = True
            self.load_attempts += 1
            return True
        return False

    async def analyze_text(self, text, call_id):  # noqa: D401
        return {
            "intent": {"intent": "statement", "confidence": 0.5},
            "sentiment": {"sentiment": "neutral", "sentiment_score": 0},
            "risk": {"escalation_risk": "low", "risk_score": 0},
            "keywords": text.split(),
            "call_id": call_id,
        }


class _StubAudioProcessor:
    def convert_audio_format(self, path, **_kwargs):  # noqa: D401
        return {"output_path": path, "conversion_success": True}

    def analyze_audio_file(self, path):  # noqa: D401
        return {"duration_seconds": 1.23, "path": path}


class _StubDatabaseIntegration:
    def update_call_status(self, *args, **kwargs):  # noqa: D401
        return None

    def store_transcript(self, *args, **kwargs):  # noqa: D401
        return {"store_success": True}

    def store_audio_analysis(self, *args, **kwargs):  # noqa: D401
        return {"store_success": True}

    def store_nlp_analysis(self, *args, **kwargs):  # noqa: D401
        return {"store_success": True}


class _StubUploadHandler:
    async def validate_upload(self, *args, **kwargs):  # pragma: no cover - unused in tests
        return {"is_valid": True, "file_info": {"size": 0}}

    async def save_audio_file(self, *args, **kwargs):  # pragma: no cover
        return "stub.wav"

    async def create_call_record(self, *args, **kwargs):  # pragma: no cover
        return {"created": True}


@pytest.fixture
def pipeline_with_stubs(monkeypatch, tmp_path):
    """Provide an AudioProcessingPipeline wired to stubbed dependencies for lazy-load testing."""

    from backend.app import pipeline_orchestrator as po

    monkeypatch.setenv("SIGNALHUB_LIVE_TRANSCRIPTION", "0")
    monkeypatch.setenv("SIGNALHUB_LIVE_BATCH_ONLY", "1")

    stub_debug_dir = Path(tempfile.mkdtemp(prefix="signalhub-debug-"))
    monkeypatch.setattr(
        po,
        "debug_helper",
        SimpleNamespace(
            debug_dir=stub_debug_dir,
            log_debug_info=lambda *_args, **_kwargs: None,
            capture_exception=lambda *_args, **_kwargs: None,
        ),
    )

    monkeypatch.setattr(po, "pipeline_monitor", SimpleNamespace(
        start_pipeline_monitoring=lambda *_args, **_kwargs: None,
        update_pipeline_step=lambda *_args, **_kwargs: None,
        complete_pipeline=lambda *_args, **_kwargs: None,
        fail_pipeline=lambda *_args, **_kwargs: None,
        get_active_pipelines=lambda *_args, **_kwargs: [],
        get_pipeline_history=lambda *_args, **_kwargs: [],
        get_performance_summary=lambda *_args, **_kwargs: {},
    ))

    monkeypatch.setattr(po, "AudioUploadHandler", _StubUploadHandler)
    monkeypatch.setattr(po, "AudioProcessor", _StubAudioProcessor)
    monkeypatch.setattr(po, "DatabaseIntegration", _StubDatabaseIntegration)
    monkeypatch.setattr(po, "WhisperProcessor", _StubWhisperProcessor)

    stub_nlp = _StubNLPProcessor()
    monkeypatch.setattr(po, "nlp_processor", stub_nlp)

    pipeline = po.AudioProcessingPipeline()

    async def _immediate_retry(self, operation_func, operation_name: str, max_retries: int = 0):  # noqa: D401
        return operation_func()

    pipeline._retry_operation = MethodType(_immediate_retry, pipeline)

    return pipeline, pipeline.whisper_processor, stub_nlp


@pytest.mark.asyncio
async def test_pipeline_transcription_triggers_single_model_load(pipeline_with_stubs):
    pipeline, whisper_stub, _ = pipeline_with_stubs

    call_id = "call-transcribe"
    pipeline.pipeline_data[call_id] = {
        "file_path": "dummy.wav",
        "processed_file_path": "dummy.wav",
    }

    result = await pipeline._step_transcription(call_id)
    assert result["transcription_text"].startswith("stub transcript")
    assert whisper_stub.load_attempts == 1

    result_again = await pipeline._step_transcription(call_id)
    assert result_again["transcription_text"].startswith("stub transcript")
    assert whisper_stub.load_attempts == 1, "Whisper model should not reload on subsequent calls"


@pytest.mark.asyncio
async def test_pipeline_nlp_analysis_triggers_single_resource_load(pipeline_with_stubs):
    pipeline, _, nlp_stub = pipeline_with_stubs

    call_id = "call-nlp"
    pipeline.pipeline_data[call_id] = {
        "transcription_data": {"text": "hello world"},
    }

    result = await pipeline._step_nlp_analysis(call_id)
    assert result["nlp_analysis_completed"] is True
    assert nlp_stub.load_attempts == 1

    result_again = await pipeline._step_nlp_analysis(call_id)
    assert result_again["nlp_analysis_completed"] is True
    assert nlp_stub.load_attempts == 1, "NLP resources should not reload on subsequent calls"


@pytest.mark.asyncio
async def test_reanalyze_endpoint_uses_lazy_loaded_nlp(monkeypatch):
    from backend.app import main as app_mod

    fake_call = SimpleNamespace(call_id="abc123")
    fake_transcript = SimpleNamespace(text="friendly greeting")

    class _FakeQuery:
        def __init__(self, value):
            self._value = value

        def filter(self, *_args, **_kwargs):
            return self

        def first(self):
            return self._value

    class _FakeSession:
        def __init__(self, call, transcript):
            self._call = call
            self._transcript = transcript

        def query(self, model):
            if model.__name__ == "Call":
                return _FakeQuery(self._call)
            if model.__name__ == "Transcript":
                return _FakeQuery(self._transcript)
            raise AssertionError("Unexpected model query")

    stub_nlp = _StubNLPProcessor()
    monkeypatch.setattr(app_mod, "nlp_processor", stub_nlp)
    monkeypatch.setattr(app_mod.db_integration, "store_nlp_analysis", lambda *_args, **_kwargs: {"store_success": True})

    response = await app_mod.reanalyze_call("abc123", db=_FakeSession(fake_call, fake_transcript))
    assert response["message"] == "Reanalysis completed"
    assert stub_nlp.load_attempts == 1

    response_again = await app_mod.reanalyze_call("abc123", db=_FakeSession(fake_call, fake_transcript))
    assert response_again["message"] == "Reanalysis completed"
    assert stub_nlp.load_attempts == 1, "Reanalysis should not trigger another NLP load"
