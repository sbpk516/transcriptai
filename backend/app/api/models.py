"""API endpoints for managing Whisper models."""
import logging
import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Literal, Union

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, BackgroundTasks

from ..whisper_backend_selector import get_global_whisper_processor, get_model_preference_path
from ..whisper_processor import WhisperProcessor

logger = logging.getLogger("transcriptai.models")
router = APIRouter(prefix="/models", tags=["models"])

ModelStatus = Literal["idle", "downloading", "downloaded", "error", "needs_update"]


class ModelInfo(BaseModel):
    name: str
    is_downloaded: bool
    is_active: bool
    size_mb: float = 0.0  # Approximate size
    status: ModelStatus
    progress: Optional[float] = None
    message: Optional[str] = None
    version: Optional[str] = None
    updated_at: Optional[str] = None
    backend: Optional[str] = None
    management_supported: Optional[bool] = None
    runtime_model: Optional[str] = None


class ModelSelectRequest(BaseModel):
    name: str


class ModelDownloadRequest(BaseModel):
    name: str


# Approximate sizes for models (in MB)
MODEL_SIZES = {
    "tiny": 75,
    "base": 145,
    "small": 480,
    "medium": 1500,
    "large": 3000,
    "large-v2": 3000,
    "large-v3": 3000,
}

# Simplified version pinning per model. Can be refined to actual HF revisions later.
MODEL_VERSIONS = {
    "tiny": "main",
    "base": "main",
    "small": "main",
    "medium": "main",
    "large": "main",
    "large-v2": "main",
    "large-v3": "main",
}

_JOB_LOCKS: Dict[str, threading.RLock] = {}
_GLOBAL_DOWNLOADS = threading.Semaphore(2)  # simple global cap; adjust as needed
_STALE_DOWNLOAD_MINUTES = 15


def _job_state_path() -> Path:
    pref_path = get_model_preference_path()
    return pref_path.parent / "model_jobs.json"


def _load_job_state() -> Dict[str, Dict[str, Any]]:
    path = _job_state_path()
    if not path.exists():
        return {}
    try:
        with open(path, "r") as f:
            raw = json.load(f)
        # Normalize stale downloads to error to prevent perpetual "downloading"
        normalized: Dict[str, Dict[str, Any]] = {}
        now = datetime.now()
        for name, entry in raw.items():
            status = entry.get("status")
            updated = entry.get("updated_at")
            try:
                updated_dt = datetime.fromisoformat(updated) if updated else None
            except Exception:
                updated_dt = None
            if status == "downloading":
                if updated_dt and (now - updated_dt).total_seconds() > _STALE_DOWNLOAD_MINUTES * 60:
                    entry["status"] = "error"
                    entry["message"] = "Download timed out; please retry."
                    entry["progress"] = None
                    entry["updated_at"] = now.isoformat()
            normalized[name] = entry
        if normalized != raw:
            _save_job_state(normalized)
        return normalized
    except Exception as exc:
        logger.warning(f"Failed to load model job state: {exc}")
        return {}


def _save_job_state(state: Dict[str, Dict[str, Any]]) -> None:
    path = _job_state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(state, f)
    except Exception as exc:
        logger.warning(f"Failed to persist model job state: {exc}")


def _get_lock(name: str) -> threading.RLock:
    if name not in _JOB_LOCKS:
        _JOB_LOCKS[name] = threading.RLock()
    return _JOB_LOCKS[name]


def _desired_version(name: str) -> str:
    return MODEL_VERSIONS.get(name, "main")


def _whisper_cpp_model_label() -> str:
    env_value = os.getenv("WHISPER_CPP_MODEL") or os.getenv("WHISPER_CPP_MODEL_NAME")
    if env_value:
        label = Path(env_value).name
    else:
        label = "ggml-base.en.bin"
    if label.endswith(".bin"):
        label = label[:-4]
    return label


def _supports_model_management(processor: Any) -> bool:
    return all(
        hasattr(processor, attr)
        for attr in ("get_available_models", "is_model_cached", "download_model", "reload_model")
    )


def _mark_state(
    model_name: str,
    status: ModelStatus,
    *,
    progress: Optional[float] = None,
    message: Optional[str] = None,
    version: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    state = _load_job_state()
    state[model_name] = {
        "status": status,
        "progress": progress,
        "message": message,
        "version": version,
        "updated_at": datetime.now().isoformat(),
    }
    _save_job_state(state)
    return state


def _current_state_for_model(model_name: str) -> Dict[str, Any]:
    state = _load_job_state()
    return state.get(model_name, {})


def _derive_model_info(
    processor: WhisperProcessor,
    model_name: str,
    active_model: str,
    job_state: Dict[str, Dict[str, Any]],
    backend: Optional[str],
) -> ModelInfo:
    cached = processor.is_model_cached(model_name)
    state = job_state.get(model_name, {})
    desired_version = _desired_version(model_name)
    status: ModelStatus = state.get("status", "idle")  # type: ignore
    message = state.get("message")
    progress = state.get("progress")
    version = state.get("version")

    # Version mismatch check if cached
    version_mismatch = cached and version not in (None, desired_version)
    if version_mismatch:
        status = "needs_update"
        message = "Model cache outdated. Please re-download."
        cached = False

    # Stale in-flight detection: if downloading too long or missing timestamps, flip to error so UI can recover
    if status == "downloading":
        try:
            updated_str = state.get("updated_at")
            updated_dt = datetime.fromisoformat(updated_str) if updated_str else None
            stale = False
            if updated_dt:
                stale = (datetime.now() - updated_dt).total_seconds() > _STALE_DOWNLOAD_MINUTES * 60
            else:
                stale = True
            if stale:
                status = "error"
                message = "Download timed out; please retry."
                cached = False
        except Exception:
            pass
    elif cached and not version_mismatch:
        status = "downloaded"
        progress = 1.0
        version = desired_version if version is None else version
    elif status == "error":
        cached = False
    else:
        status = "idle"
        cached = False

    return ModelInfo(
        name=model_name,
        is_downloaded=cached,
        is_active=(model_name == active_model),
        size_mb=MODEL_SIZES.get(model_name, 0),
        status=status,
        progress=progress,
        message=message,
        version=version,
        updated_at=state.get("updated_at"),
        backend=backend,
        management_supported=True,
    )


@router.get("", response_model=List[ModelInfo])
async def list_models() -> List[ModelInfo]:
    """List available models and their status."""
    processor = get_global_whisper_processor()

    if not _supports_model_management(processor):
        backend = getattr(processor, "device", None) or "whisper.cpp"
        runtime_model = _whisper_cpp_model_label() if isinstance(processor, WhisperProcessor) else None
        name = runtime_model or getattr(processor, "model_name", "tiny")
        return [
            ModelInfo(
                name=name,
                is_downloaded=True,
                is_active=True,
                size_mb=MODEL_SIZES.get(name, 0),
                status="downloaded",
                progress=1.0,
                message="Model management is unavailable for this backend.",
                version=_desired_version(name),
                backend=backend,
                management_supported=False,
                runtime_model=runtime_model,
            )
        ]

    available_models = processor.get_available_models()
    active_model = processor.model_name
    job_state = _load_job_state()
    backend = getattr(processor, "device", None)

    result = []
    for name in available_models:
        result.append(_derive_model_info(processor, name, active_model, job_state, backend))

    return result


def _download_job(model_name: str, desired_version: str, *, has_global: bool = True) -> None:
    """Background download job with error handling and state persistence."""
    processor = get_global_whisper_processor()
    if not _supports_model_management(processor):
        _mark_state(model_name, "error", message="Model management unavailable")
        if has_global:
            try:
                _GLOBAL_DOWNLOADS.release()
            except Exception:
                pass
        return

    start_ts = time.perf_counter()
    lock = _get_lock(model_name)
    # Do not hold lock for the full download; just ensure single updater
    acquired = lock.acquire(timeout=1)
    if not acquired:
        if has_global:
            try:
                _GLOBAL_DOWNLOADS.release()
            except Exception:
                pass
        return
    try:
        _mark_state(model_name, "downloading", progress=0.0, message=None, version=desired_version)
    finally:
        lock.release()

    acquired_global = has_global
    has_terminal_state = False
    try:
        # _GLOBAL_DOWNLOADS was acquired at request time; keep track to release once
        # Heartbeat before starting
        with lock:
            _mark_state(model_name, "downloading", progress=0.0, message=None, version=desired_version)

        # Heartbeat loop wrapper with timeout
        result: Optional[bool] = None
        stop_event = threading.Event()

        def _run_download():
            nonlocal result
            try:
                result = processor.download_model(model_name)
            except Exception:
                result = False
            finally:
                stop_event.set()

        worker = threading.Thread(target=_run_download, daemon=True)
        worker.start()

        # Poll heartbeat every 5 seconds until done or timeout
        timeout_seconds = _STALE_DOWNLOAD_MINUTES * 60
        start = time.perf_counter()
        while not stop_event.wait(timeout=5):
            with lock:
                _mark_state(model_name, "downloading", progress=0.0, message=None, version=desired_version)
            if time.perf_counter() - start > timeout_seconds:
                has_terminal_state = True
                with lock:
                    _mark_state(model_name, "error", message="Download exceeded time limit; please retry.", version=None)
                return

        # After completion, evaluate result
        if not result:
            raise RuntimeError("Download failed")
        if not processor.is_model_cached(model_name):
            raise RuntimeError("Model cache missing after download")
        with lock:
            _mark_state(model_name, "downloaded", progress=1.0, message=None, version=desired_version)
        has_terminal_state = True
    except Exception as exc:
        has_terminal_state = True
        logger.error(f"Download job failed for {model_name}: {exc}")
        with lock:
            _mark_state(model_name, "error", message=str(exc), version=None)
    finally:
        try:
            # Skip elapsed check if already timed out or status is already terminal
            if not has_terminal_state:
                current_state = _current_state_for_model(model_name)
                status = current_state.get("status")
                if status not in ("error", "downloaded"):
                    elapsed = time.perf_counter() - start_ts
                    if elapsed > _STALE_DOWNLOAD_MINUTES * 60:
                        with lock:
                            _mark_state(model_name, "error", message="Download exceeded time limit; please retry.", version=None)
        except Exception:
            pass
        if acquired_global:
            try:
                _GLOBAL_DOWNLOADS.release()
            except Exception:
                pass


@router.post("/download")
async def download_model(request: ModelDownloadRequest, background_tasks: BackgroundTasks):
    """Trigger background download of a model."""
    processor = get_global_whisper_processor()
    if not _supports_model_management(processor):
        raise HTTPException(status_code=400, detail="Model management not available for this backend")

    if request.name not in processor.get_available_models():
        raise HTTPException(status_code=400, detail="Invalid model name")

    desired_version = _desired_version(request.name)
    current_state = _current_state_for_model(request.name)
    lock = _get_lock(request.name)

    if current_state.get("status") == "downloading":
        raise HTTPException(status_code=409, detail="Download already in progress")

    # Active models are considered downloaded unless marked error/needs_update
    is_cached = processor.is_model_cached(request.name)
    if is_cached and current_state.get("status") not in ("error", "needs_update"):
        _mark_state(request.name, "downloaded", progress=1.0, message=None, version=desired_version)
        return {"status": "downloaded", "model": request.name}

    # Acquire global cap up front to reject quickly
    if not _GLOBAL_DOWNLOADS.acquire(timeout=0):
        raise HTTPException(status_code=409, detail="Global download limit reached. Please retry.")

    acquired = lock.acquire(timeout=1)
    if not acquired:
        _GLOBAL_DOWNLOADS.release()
        raise HTTPException(status_code=409, detail="Another download lock is held")
    try:
        _mark_state(request.name, "downloading", progress=0.0, message=None, version=desired_version)
        background_tasks.add_task(_download_job, request.name, desired_version, has_global=True)
    finally:
        lock.release()

    return {"status": "download_started", "model": request.name}


@router.post("/select")
async def select_model(request: ModelSelectRequest):
    """Select the active model."""
    processor = get_global_whisper_processor()
    if not _supports_model_management(processor):
        raise HTTPException(status_code=400, detail="Model management not available for this backend")

    if request.name not in processor.get_available_models():
        raise HTTPException(status_code=400, detail="Invalid model name")

    state = _current_state_for_model(request.name)
    is_cached = processor.is_model_cached(request.name)

    if not is_cached:
        raise HTTPException(status_code=400, detail="Model not downloaded. Please download first.")
    if state.get("status") in ("error", "needs_update"):
        raise HTTPException(status_code=400, detail="Model is unavailable; please re-download before selecting.")

    # Update persistence
    try:
        pref_path = get_model_preference_path()
        with open(pref_path, 'w') as f:
            json.dump({"model_name": request.name}, f)
    except Exception as e:
        logger.error(f"Failed to save model preference: {e}")
        raise HTTPException(status_code=500, detail="Failed to save preference")

    # Reload processor
    try:
        success = processor.reload_model(request.name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to reload model")
        # Mark selected model as downloaded/healthy
        _mark_state(request.name, "downloaded", progress=1.0, message=None, version=_desired_version(request.name))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reload model: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "ok", "active_model": request.name}
