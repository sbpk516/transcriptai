"""
Configuration settings for TranscriptAI application.
"""
from pydantic_settings import BaseSettings
from typing import List, Union
import os
from pathlib import Path


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database Configuration
    database_url: str = "postgresql://transcriptai:transcriptai123@localhost:5432/transcriptai"
    # For SQLite (desktop mode): set via env based on TRANSCRIPTAI_DATA_DIR
    
    # Application Configuration
    app_name: str = "TranscriptAI"
    debug: bool = True
    secret_key: str = "your-secret-key-here-change-in-production"
    
    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8001  # Changed from 8000 to avoid conflicts
    
    # Logging
    log_level: str = "DEBUG"
    log_file: str = "logs/transcriptai.log"
    
    # API Configuration
    api_v1_str: str = "/api/v1"
    project_name: str = "Contact Center TranscriptAI"
    
    # CORS Configuration (for future frontend)
    # Allow all origins to support file:// protocol in packaged desktop app
    backend_cors_origins: List[str] = ["*"]
    
    # File Upload Configuration
    max_file_size: Union[int, str] = 10 * 1024 * 1024 * 1024  # 10GB in bytes
    upload_dir: str = "../audio_uploads"  # Overridden in desktop mode
    
    # Feature Flags
    # Live/progressive transcription (SSE). Enabled by default.
    live_transcription: bool = True
    # Microphone-based live capture (MediaRecorder chunks). Enabled by default.
    live_mic: bool = True
    
    @property
    def max_file_size_bytes(self) -> int:
        """Convert max_file_size to bytes if it's a string."""
        if isinstance(self.max_file_size, str):
            # Handle string format like "10GB"
            size_str = self.max_file_size.upper()
            if size_str.endswith('MB'):
                return int(size_str[:-2]) * 1024 * 1024
            elif size_str.endswith('KB'):
                return int(size_str[:-2]) * 1024
            elif size_str.endswith('GB'):
                return int(size_str[:-2]) * 1024 * 1024 * 1024
            else:
                return int(size_str)
        return self.max_file_size
    
class Config:
        env_file = ".env"
        case_sensitive = False


# Create settings instance
settings = Settings()


def _desktop_data_dir() -> Path:
    """Resolve desktop data directory from env."""
    data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
    if data_dir:
        return Path(data_dir)
    # Fallback to local folder if not provided
    return Path.cwd() / "transcriptai_data"


def get_database_url() -> str:
    """Get database URL from environment or use default.

    In desktop mode (TRANSCRIPTAI_MODE=desktop), prefer SQLite DB under the provided data dir.
    """
    # Desktop mode override
    if os.getenv("TRANSCRIPTAI_MODE", "").lower() == "desktop":
        data_dir = _desktop_data_dir()
        try:
            data_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        db_path = data_dir / "transcriptai.db"
        return f"sqlite:///{db_path}"
    # Server/default mode
    return os.getenv("DATABASE_URL", settings.database_url)


def get_secret_key() -> str:
    """Get secret key from environment or use default."""
    return os.getenv("SECRET_KEY", settings.secret_key)


def is_live_transcription_enabled() -> bool:
    """Return True if live transcription (SSE) is enabled via env.

    Controlled by TRANSCRIPTAI_LIVE_TRANSCRIPTION (default: enabled).
    """
    return os.getenv("TRANSCRIPTAI_LIVE_TRANSCRIPTION", "1") == "1"


def is_live_mic_enabled() -> bool:
    """Return True if mic-based live capture is enabled via env.

    Controlled by TRANSCRIPTAI_LIVE_MIC (default: enabled).
    """
    return os.getenv("TRANSCRIPTAI_LIVE_MIC", "1") == "1"


def is_live_batch_only() -> bool:
    """Return True to disable chunk STT/SSE and transcribe only at stop.

    Controlled by TRANSCRIPTAI_LIVE_BATCH_ONLY=1. Defaults to False.
    """
    return os.getenv("TRANSCRIPTAI_LIVE_BATCH_ONLY", "0") == "1"


def get_user_models_dir() -> Path:
    """Get user-writable models directory for downloads.

    In desktop mode: ~/Library/Application Support/TranscriptAI/models/
    In dev/web mode: backend-cpp/models/ relative to project root
    """
    data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
    if data_dir:
        models_dir = Path(data_dir) / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        return models_dir
    # Dev/web mode: use backend-cpp/models relative to backend directory
    return Path(__file__).parent.parent.parent / "backend-cpp" / "models"


def get_bundled_models_dir() -> Path | None:
    """Get read-only bundled models directory (prod DMG only).

    Returns None if not in production mode or env var not set.
    """
    bundled = os.getenv("TRANSCRIPTAI_BUNDLED_MODELS_DIR")
    if bundled:
        return Path(bundled)
    return None


def get_model_path(model_name: str) -> Path | None:
    """Find model file path, checking bundled dir first, then user dir, then dev dir.

    Args:
        model_name: Model name like 'tiny', 'base', 'small'

    Returns:
        Path to model file if found, None otherwise
    """
    filename = f"ggml-{model_name}.en.bin"

    # Check bundled models first (prod DMG - read-only)
    bundled_dir = get_bundled_models_dir()
    if bundled_dir:
        bundled_path = bundled_dir / filename
        if bundled_path.exists():
            return bundled_path

    # Check user models directory (writable, for downloaded models)
    user_dir = get_user_models_dir()
    user_path = user_dir / filename
    if user_path.exists():
        return user_path

    # Check dev models directory (for web/dev mode)
    dev_dir = Path(__file__).parent.parent.parent / "backend-cpp" / "models"
    dev_path = dev_dir / filename
    if dev_path.exists():
        return dev_path

    return None


def is_model_downloaded(model_name: str) -> bool:
    """Check if a model is available (downloaded or bundled)."""
    return get_model_path(model_name) is not None


# ----- VAD (Voice Activity Detection) Configuration -----

def is_vad_enabled() -> bool:
    """Return True if Voice Activity Detection is enabled.

    Controlled by TRANSCRIPTAI_VAD_ENABLED (default: enabled).
    Set to '0' to disable VAD.
    """
    return os.getenv("TRANSCRIPTAI_VAD_ENABLED", "1") != "0"


def get_vad_threshold() -> float:
    """Get VAD threshold (0.0-1.0). Higher = more aggressive silence filtering.

    Controlled by TRANSCRIPTAI_VAD_THRESHOLD (default: 0.5).
    """
    try:
        value = os.getenv("TRANSCRIPTAI_VAD_THRESHOLD", "0.5")
        if not value:
            return 0.5
        return float(value)
    except ValueError:
        return 0.5


def get_vad_model_path() -> Path | None:
    """Find silero-vad.onnx model path.

    Checks: bundled dir -> user dir -> dev dir.
    Returns None if not found.
    """
    filename = "silero-vad.bin"

    # Check bundled models first (prod DMG - read-only)
    bundled_dir = get_bundled_models_dir()
    if bundled_dir:
        bundled_path = bundled_dir / filename
        if bundled_path.exists():
            return bundled_path

    # Check user models directory (writable, for downloaded models)
    user_dir = get_user_models_dir()
    user_path = user_dir / filename
    if user_path.exists():
        return user_path

    # Check dev models directory (for web/dev mode)
    dev_dir = Path(__file__).parent.parent.parent / "backend-cpp" / "models"
    dev_path = dev_dir / filename
    if dev_path.exists():
        return dev_path

    return None


def is_vad_model_available() -> bool:
    """Check if VAD model is downloaded and available."""
    return get_vad_model_path() is not None


# Override upload_dir for desktop mode at import-time
if os.getenv("TRANSCRIPTAI_MODE", "").lower() == "desktop":
    data_dir = _desktop_data_dir()
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    # Place uploads and logs under the desktop data directory
    uploads_dir = data_dir / "uploads"
    logs_dir = data_dir / "logs"
    try:
        uploads_dir.mkdir(parents=True, exist_ok=True)
        logs_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    settings.upload_dir = str(uploads_dir)
    settings.log_file = str(logs_dir / "transcriptai.log")
