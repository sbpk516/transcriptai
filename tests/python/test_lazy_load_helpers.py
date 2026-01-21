"""Tests for lazy-loading helpers in Whisper and NLP processors."""

import asyncio
import os
import sys
import tempfile
import threading
from pathlib import Path
from types import MethodType, ModuleType, SimpleNamespace
import subprocess
from typing import List

import pytest

UPLOAD_ROOT = Path(__file__).resolve().parent / "audio_uploads"
os.environ.setdefault("UPLOAD_DIR", str(UPLOAD_ROOT))
os.environ.setdefault("SIGNALHUB_OFFLINE", "1")
os.environ.setdefault("SIGNALHUB_DATA_DIR", tempfile.mkdtemp(prefix="signalhub-data-"))

_ORIGINAL_SUBPROCESS_RUN = subprocess.run


def _safe_subprocess_run(cmd, *args, **kwargs):
    cmd_head = cmd[0] if isinstance(cmd, (list, tuple)) and cmd else cmd
    if isinstance(cmd_head, str) and cmd_head.lower().endswith("ffmpeg"):
        return SimpleNamespace(returncode=0, stdout="ffmpeg version stub", stderr="")
    if isinstance(cmd_head, str) and cmd_head == "ffmpeg":
        return SimpleNamespace(returncode=0, stdout="ffmpeg version stub", stderr="")
    return _ORIGINAL_SUBPROCESS_RUN(cmd, *args, **kwargs)


subprocess.run = _safe_subprocess_run

if "torch" not in sys.modules:
    class _FakeCuda:
        @staticmethod
        def is_available() -> bool:
            return False

        @staticmethod
        def device_count() -> int:
            return 0

    sys.modules["torch"] = SimpleNamespace(cuda=_FakeCuda())

if "whisper" not in sys.modules:
    class _FakeModel:
        def parameters(self):
            return []

        def transcribe(self, *args, **kwargs):  # pragma: no cover - fallback safety
            return {"text": "", "segments": []}

    def _fake_load_model(*args, **kwargs):
        return _FakeModel()

    sys.modules["whisper"] = SimpleNamespace(load_model=_fake_load_model)

if "backend.app.audio_processor" not in sys.modules:
    fake_audio_module = ModuleType("backend.app.audio_processor")

    class _FakeAudioProcessor:
        def analyze_audio_file(self, *_args, **_kwargs):
            return {"duration_seconds": 0}

        def convert_audio_format(self, path, **_kwargs):  # pragma: no cover - stub for compatibility
            return {"output_path": path, "conversion_success": True}

    fake_audio_module.audio_processor = _FakeAudioProcessor()
    fake_audio_module.AudioProcessor = _FakeAudioProcessor
    sys.modules["backend.app.audio_processor"] = fake_audio_module

if "nltk" not in sys.modules:
    fake_nltk = ModuleType("nltk")

    def _noop_download(*_args, **_kwargs):
        return None

    fake_nltk.download = _noop_download

    nltk_corpus = ModuleType("nltk.corpus")

    class _FakeStopwords:
        @staticmethod
        def words(_language):
            return []

    nltk_corpus.stopwords = _FakeStopwords()

    nltk_tokenize = ModuleType("nltk.tokenize")

    def _fake_word_tokenize(text):
        return text.split()

    nltk_tokenize.word_tokenize = _fake_word_tokenize

    nltk_stem = ModuleType("nltk.stem")

    class _FakeWordNetLemmatizer:
        def lemmatize(self, token):
            return token

    nltk_stem.WordNetLemmatizer = _FakeWordNetLemmatizer

    fake_nltk.corpus = nltk_corpus
    fake_nltk.tokenize = nltk_tokenize
    fake_nltk.stem = nltk_stem

    sys.modules.update({
        "nltk": fake_nltk,
        "nltk.corpus": nltk_corpus,
        "nltk.tokenize": nltk_tokenize,
        "nltk.stem": nltk_stem,
        "nltk.corpus.stopwords": nltk_corpus,
    })

if "vaderSentiment.vaderSentiment" not in sys.modules:
    vader_module = ModuleType("vaderSentiment.vaderSentiment")

    class _FakeSentimentIntensityAnalyzer:
        def polarity_scores(self, _text):
            return {"compound": 0.0, "pos": 0.0, "neg": 0.0, "neu": 1.0}

    vader_module.SentimentIntensityAnalyzer = _FakeSentimentIntensityAnalyzer
    sys.modules.setdefault("vaderSentiment", ModuleType("vaderSentiment"))
    sys.modules["vaderSentiment.vaderSentiment"] = vader_module


from backend.app.whisper_processor import WhisperProcessor
from backend.app.nlp_processor import NLPProcessor


def _bind(instance, func):
    """Bind a function as a method on an instance."""
    return MethodType(func, instance)


def test_whisper_ensure_loaded_single_thread():
    processor = WhisperProcessor(model_name="tiny-test")
    call_order: List[str] = []

    def fake_load(self):
        call_order.append("load")
        self._model_loaded = True
        return True

    processor._load_model = _bind(processor, fake_load)

    first_result = processor.ensure_loaded()
    assert first_result is True
    assert call_order == ["load"]
    assert processor._model_loaded is True
    assert processor._loading_in_progress is False
    assert processor._last_load_elapsed is not None

    second_result = processor.ensure_loaded()
    assert second_result is False
    assert call_order == ["load"]


def test_whisper_ensure_loaded_concurrent_calls():
    processor = WhisperProcessor(model_name="tiny-test")
    call_counter = 0
    load_started = threading.Event()
    release_load = threading.Event()
    results: List[bool] = []
    errors = []

    def fake_load(self):
        nonlocal call_counter
        call_counter += 1
        load_started.set()
        release_load.wait(timeout=1)
        if not release_load.is_set():
            raise RuntimeError("whisper load did not release in time")
        self._model_loaded = True
        return True

    processor._load_model = _bind(processor, fake_load)

    def invoke():
        try:
            results.append(processor.ensure_loaded())
        except Exception as exc:  # pragma: no cover - debugging safety
            errors.append(exc)

    first = threading.Thread(target=invoke)
    second = threading.Thread(target=invoke)

    first.start()
    assert load_started.wait(timeout=1), "first call did not enter load"
    second.start()

    try:
        assert processor._loading_in_progress is True
    finally:
        release_load.set()

    first.join(timeout=1)
    second.join(timeout=1)

    assert not errors
    assert results.count(True) == 1
    assert results.count(False) == 1
    assert call_counter == 1
    assert processor._loading_in_progress is False


def teardown_module(module):  # pragma: no cover - restore patched subprocess
    subprocess.run = _ORIGINAL_SUBPROCESS_RUN


@pytest.mark.asyncio
async def test_nlp_ensure_loaded_single_task():
    processor = NLPProcessor()
    call_counter = 0

    async def fake_load(self):
        nonlocal call_counter
        call_counter += 1
        self.models_loaded = True

    processor._load_resources = _bind(processor, fake_load)

    first = await processor.ensure_loaded()
    assert first is True
    assert call_counter == 1
    assert processor.models_loaded is True
    assert processor._loading_in_progress is False
    assert processor._last_load_elapsed is not None

    second = await processor.ensure_loaded()
    assert second is False
    assert call_counter == 1


@pytest.mark.asyncio
async def test_nlp_ensure_loaded_concurrent_tasks():
    processor = NLPProcessor()
    call_counter = 0
    load_started = asyncio.Event()
    release_load = asyncio.Event()
    results: List[bool] = []

    async def fake_load(self):
        nonlocal call_counter
        call_counter += 1
        load_started.set()
        await release_load.wait()
        self.models_loaded = True

    processor._load_resources = _bind(processor, fake_load)

    async def invoke(wait_for_start: bool = False):
        if wait_for_start:
            await load_started.wait()
        return await processor.ensure_loaded()

    first_task = asyncio.create_task(invoke())
    await load_started.wait()
    second_task = asyncio.create_task(invoke(wait_for_start=True))
    await asyncio.sleep(0)

    try:
        assert processor._loading_in_progress is True
    finally:
        release_load.set()

    results.extend([await first_task, await second_task])

    assert results.count(True) == 1
    assert results.count(False) == 1
    assert call_counter == 1
    assert processor._loading_in_progress is False
