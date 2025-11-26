#!/usr/bin/env python3
"""
Desktop entrypoint for bundled backend.

Reads TRANSCRIPTAI_MODE, TRANSCRIPTAI_PORT, TRANSCRIPTAI_DATA_DIR from environment and
starts the FastAPI app using uvicorn bound to 127.0.0.1.

This avoids relying on repository files like config.js when running from a packaged app.
"""
import os
import sys
import traceback
from typing import Optional
from datetime import datetime

try:
    import uvicorn
except ImportError as e:
    print(f"❌ CRITICAL: Failed to import uvicorn: {e}")
    print("   Please install uvicorn: pip install uvicorn")
    sys.exit(1)

APP_IMPORT_ERROR = None
app = None  # type: ignore

try:
    from app.mlx_runtime import activate_mlx_site_packages, get_mlx_venv_root
except Exception:  # pragma: no cover
    activate_mlx_site_packages = None  # type: ignore
    get_mlx_venv_root = None  # type: ignore


def getenv_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def write_error_log(data_dir: Optional[str], error_type: str, error_msg: str, trace: Optional[str] = None) -> None:
    """Write error to log file with timestamp and full traceback."""
    if not data_dir:
        return
    try:
        logs_dir = os.path.join(data_dir, "logs")
        os.makedirs(logs_dir, exist_ok=True)
        error_file = os.path.join(logs_dir, f"backend_error_{error_type}.txt")
        with open(error_file, "a") as f:
            f.write(f"\n{'='*60}\n")
            f.write(f"Timestamp: {datetime.now().isoformat()}\n")
            f.write(f"Error Type: {error_type}\n")
            f.write(f"Error Message: {error_msg}\n")
            if trace:
                f.write(f"\nTraceback:\n{trace}\n")
            f.write(f"{'='*60}\n")
    except Exception:
        pass  # Silently fail if we can't write logs


def main() -> int:
    # Desktop mode env
    os.environ.setdefault("TRANSCRIPTAI_MODE", "desktop")

    port = getenv_int("TRANSCRIPTAI_PORT", 8001)
    host = "127.0.0.1"

    data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
        logs_dir = os.path.join(data_dir, "logs")
        os.makedirs(logs_dir, exist_ok=True)
        print(f"📁 Desktop data dir: {data_dir}")
        # Sentinel: prove writeability and capture earliest failures
        try:
            with open(os.path.join(logs_dir, "backend_boot.txt"), "a") as f:
                f.write(f"boot at {datetime.now().isoformat()}\n")
        except Exception as se:
            print(f"❌ Log dir not writable: {se}")
            write_error_log(data_dir, "startup", f"Log dir not writable: {se}")

    # Import app only after logs dir exists so we can record any error
    global app
    if app is None:
        try:
            print("📦 Importing FastAPI app...")
            sys.stdout.flush()

            # Check for critical dependencies before importing
            try:
                import fastapi
            except ImportError as e:
                error_msg = f"Missing dependency: fastapi - {e}"
                print(f"❌ {error_msg}")
                write_error_log(data_dir, "import", error_msg, traceback.format_exc())
                return 1

            try:
                from pydantic_settings import BaseSettings
            except ImportError as e:
                error_msg = f"Missing dependency: pydantic_settings - {e}"
                print(f"❌ {error_msg}")
                print("   Please install: pip install pydantic-settings")
                write_error_log(data_dir, "import", error_msg, traceback.format_exc())
                return 1

            if activate_mlx_site_packages:
                try:
                    if activate_mlx_site_packages(reason="desktop_entry"):
                        if get_mlx_venv_root:
                            print(f"🧠 MLX venv detected at: {get_mlx_venv_root()}")
                    else:
                        print("ℹ️  MLX venv not available, continuing without MLX")
                except Exception as runtime_err:
                    error_msg = f"Failed to activate MLX venv: {runtime_err}"
                    print(f"⚠️  {error_msg}")
                    write_error_log(data_dir, "mlx", error_msg, traceback.format_exc())

            from app.main import app as _app  # type: ignore
            app = _app
            print("✅ FastAPI app imported successfully")
            sys.stdout.flush()
        except ImportError as e:
            error_msg = f"Failed to import FastAPI app module: {e}"
            print(f"❌ {error_msg}")
            trace = traceback.format_exc()
            print(trace)
            write_error_log(data_dir, "import", error_msg, trace)
            return 1
        except Exception as e:
            error_msg = f"Failed to import FastAPI app: {e}"
            print(f"❌ {error_msg}")
            trace = traceback.format_exc()
            print(trace)
            write_error_log(data_dir, "import", error_msg, trace)
            return 1

    print(f"🚀 Starting bundled backend on http://{host}:{port}")
    sys.stdout.flush()
    
    # Verify port is available before starting
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        sock.close()
    except OSError as e:
        error_msg = f"Port {port} is not available: {e}"
        print(f"❌ {error_msg}")
        write_error_log(data_dir, "port", error_msg, traceback.format_exc())
        return 1
    
    try:
        print("🔧 Calling uvicorn.run()...")
        sys.stdout.flush()
        uvicorn.run(app, host=host, port=port, log_level="info")
        return 0
    except OSError as e:
        error_msg = f"Failed to bind to port {port}: {e}"
        print(f"❌ {error_msg}")
        write_error_log(data_dir, "startup", error_msg, traceback.format_exc())
        return 1
    except Exception as e:
        error_msg = f"Error starting bundled backend: {e}"
        print(f"❌ {error_msg}")
        trace = traceback.format_exc()
        print(trace)
        write_error_log(data_dir, "startup", error_msg, trace)
        return 1


if __name__ == "__main__":
    sys.exit(main())
