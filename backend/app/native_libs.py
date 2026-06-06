"""
Cross-platform helpers for locating bundled native binaries/libraries and
platform-appropriate application data directories.

Single source of truth so platform branches don't get duplicated across modules
(noise_processor, whisper_processor, debug_utils, pipeline_logger).
"""
import os
import sys
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger('transcriptai.native_libs')

# Subdirectory under backend-cpp/ that holds the native binaries for this OS.
# Created by the Phase 0 restructure: backend-cpp/{mac,win,linux}/
_PLATFORM_DIR = {
    "darwin": "mac",
    "win32": "win",
}.get(sys.platform, "linux")


def native_lib_name(stem: str) -> str:
    """
    Return the platform-specific shared-library filename for a bare stem.

    Example: native_lib_name("rnnoise") ->
        macOS:   librnnoise.dylib
        Windows: rnnoise.dll
        Linux:   librnnoise.so
    """
    if sys.platform == "darwin":
        return f"lib{stem}.dylib"
    if sys.platform == "win32":
        return f"{stem}.dll"
    return f"lib{stem}.so"


def _backend_cpp_root() -> Path:
    """Repo backend-cpp/ directory (dev layout)."""
    return Path(__file__).resolve().parent.parent.parent / "backend-cpp"


def resolve_native_lib(stem: str) -> Optional[Path]:
    """
    Locate a bundled native library by stem, searching dev and production layouts.

    Returns the first existing path, or None if not found.
    """
    filename = native_lib_name(stem)
    backend_cpp = _backend_cpp_root()
    resources_dir = os.getenv("TRANSCRIPTAI_RESOURCES_DIR", "")

    candidates = []
    # Production: bundled next to the app resources (set by Electron in packaged builds).
    if resources_dir:
        candidates.append(Path(resources_dir) / filename)
    # Development: backend-cpp/<platform>/<lib>
    candidates.append(backend_cpp / _PLATFORM_DIR / filename)
    # Development (legacy flat layout, pre Phase 0)
    candidates.append(backend_cpp / filename)
    # Fallback: backend-cpp/lib/<lib>
    candidates.append(backend_cpp / "lib" / filename)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def app_data_dir(*subdirs: str) -> Path:
    """
    Return a writable application-data directory, honoring TRANSCRIPTAI_DATA_DIR
    when set (Electron always sets it in desktop mode), otherwise falling back to
    the OS-appropriate per-user location.

    macOS:   ~/Library/Application Support/TranscriptAI
    Windows: %APPDATA%/TranscriptAI
    Linux:   ~/.local/share/TranscriptAI
    """
    data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
    if data_dir:
        base = Path(data_dir)
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "TranscriptAI"
    elif sys.platform == "win32":
        appdata = os.getenv("APPDATA")
        base = Path(appdata) / "TranscriptAI" if appdata else Path.home() / "TranscriptAI"
    else:
        base = Path.home() / ".local" / "share" / "TranscriptAI"

    return base.joinpath(*subdirs) if subdirs else base
