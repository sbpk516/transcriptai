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
