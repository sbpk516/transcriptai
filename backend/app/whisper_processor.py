"""
Whisper integration module for TranscriptAI v2.0 (Hybrid Architecture).
Replaces local PyTorch inference with HTTP calls to the local C++ Whisper Server.
"""
import os
import time
import logging
import requests
import json
from pathlib import Path
from typing import Dict, Any, Optional, List

from .config import settings

# Configure logger
logger = logging.getLogger('transcriptai.whisper_processor')

class WhisperProcessor:
    """
    Client for the local C++ Whisper Server.
    Maintains API compatibility with the old Python implementation.
    """
    
    def __init__(self, model_name: str = "base"):
        """
        Initialize the client.
        Note: Model loading is now handled by the C++ server process.
        """
        logger.info("=== WhisperProcessor __init__ BEGIN ===")

        # Store model info for API compatibility with pipeline_orchestrator
        self.model_name = model_name
        self.device = "whisper.cpp"  # Indicates whisper.cpp backend (uses Metal on Apple Silicon)

        # Log all WHISPER/TRANSCRIPTAI env vars for debugging
        env_vars = {k: v for k, v in os.environ.items() if 'WHISPER' in k or 'TRANSCRIPTAI' in k}
        logger.info(f"Relevant env vars: {env_vars}")

        # Port discovery with multiple fallback strategies
        self.server_port = self._discover_whisper_port()
        
        self.base_url = f"http://127.0.0.1:{self.server_port}"
        logger.info(f"Initialized WhisperCPPClient pointing to {self.base_url}")
        
        # Test connectivity on startup
        try:
            status = self.get_status()
            if status.get("status") == "ready":
                logger.info(f"✓ Whisper server is reachable at {self.base_url}")
            else:
                logger.warning(f"⚠ Whisper server status: {status.get('status')} at {self.base_url}")
        except Exception as e:
            logger.error(f"✗ Failed to connect to Whisper server at {self.base_url}: {e}")
            logger.error("  Make sure whisper-server is running on the expected port")
        
        logger.info("=== WhisperProcessor __init__ END ===")

    def _discover_whisper_port(self) -> str:
        """
        Discover Whisper server port using multiple strategies.
        
        Priority:
        1. WHISPER_CPP_PORT environment variable
        2. Port file written by startup script
        3. Fallback to default port 8002
        """
        # Strategy 1: Check environment variable
        port = os.getenv("WHISPER_CPP_PORT")
        if port:
            logger.info(f"Port from WHISPER_CPP_PORT env: {port}")
            return port
        
        # Strategy 2: Read from port file
        data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR", "/tmp")
        port_file = Path(data_dir) / "transcriptai_whisper_port"
        
        try:
            if port_file.exists():
                port = port_file.read_text().strip()
                if port and port.isdigit():
                    logger.info(f"Port from file {port_file}: {port}")
                    return port
                else:
                    logger.warning(f"Port file {port_file} contains invalid data: '{port}'")
        except Exception as e:
            logger.warning(f"Failed to read port from {port_file}: {e}")
        
        # Strategy 3: Fallback to default
        fallback_port = "8002"
        logger.warning(f"Using fallback port: {fallback_port}")
        logger.warning("  If Whisper server is not on this port, connection will fail")
        
        return fallback_port

    def transcribe(
        self, 
        audio_file: str, 
        language: Optional[str] = None,
        task: str = "transcribe",
        initial_prompt: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Send audio to C++ server for transcription.
        Returns dict with 'text' and 'segments' to match old API.
        """
        
        if not os.path.exists(audio_file):
            raise FileNotFoundError(f"Audio file not found: {audio_file}")

        url = f"{self.base_url}/inference"
        
        # Prepare params
        data = {
            "response_format": "json",
            "temperature": kwargs.get("temperature", 0.0),
        }
        
        if language:
            data["language"] = language
        
        if initial_prompt:
            data["prompt"] = initial_prompt

        # Log attempt
        logger.info(
            "Sending transcription request to %s [lang=%s] file=%s exists=%s size=%s",
            url,
            language,
            audio_file,
            os.path.exists(audio_file),
            os.path.getsize(audio_file) if os.path.exists(audio_file) else "n/a",
        )
        start_time = time.time()

        try:
            with open(audio_file, 'rb') as f:
                files = {'file': (os.path.basename(audio_file), f, 'audio/wav')}
                response = requests.post(url, data=data, files=files, timeout=300) # 5 min timeout
                
            response.raise_for_status()
            result = response.json()
            
            duration = time.time() - start_time
            logger.info(f"Transcription complete in {duration:.2f}s")
            
            # Normalize response to match expected output structure
            # whisper.cpp server usually returns { "text": "...", "segments": [...] }
            # If keys are missing, fill them.
            if "text" not in result:
                # Some versions might return lines
                result["text"] = "" 
            
            return result

        except requests.exceptions.ConnectionError as e:
            error_msg = f"Connection failed to Whisper Server at {url}. Is whisper-server running on port {self.server_port}?"
            logger.error(error_msg)
            logger.error(f"  Check: ps aux | grep whisper-server")
            logger.error(f"  Check: lsof -i :{self.server_port}")
            return {
                "text": "",
                "transcription_success": False,
                "error": error_msg,
                "error_type": "connection_error"
            }
        except requests.exceptions.Timeout as e:
            error_msg = f"Whisper Server timeout at {url}"
            logger.error(error_msg)
            return {
                "text": "",
                "transcription_success": False,
                "error": error_msg,
                "error_type": "timeout_error"
            }
        except Exception as e:
            error_msg = f"Transcription failed: {e}"
            logger.error(error_msg)
            return {
                "text": "",
                "transcription_success": False,
                "error": str(e),
                "error_type": type(e).__name__
            }

    def load_model(self, model_name: str):
        # No-op in C++ architecture (model loaded at server start)
        pass

    def get_status(self) -> Dict[str, Any]:
        """
        Check health of the C++ Whisper Server.
        """
        url = f"{self.base_url}/health"
        logger.info(f"get_status: checking {url}")
        try:
            # Fast timeout for health check
            resp = requests.get(url, timeout=0.5)
            logger.info(f"get_status: response status_code={resp.status_code}, body={resp.text[:100] if resp.text else 'empty'}")
            if resp.status_code == 200:
                result = {
                    "status": "ready", # Frontend expects "ready" (not "loaded")
                    "backend": "whisper.cpp",
                    "url": self.base_url
                }
                logger.info(f"get_status: returning {result}")
                return result
            else:
                result = {"status": "error", "detail": f"HTTP {resp.status_code}"}
                logger.warning(f"get_status: returning {result}")
                return result
        except Exception as e:
            # If server is down, we report offline but don't crash
            result = {"status": "offline", "backend": "whisper.cpp", "error": str(e)}
            logger.warning(f"get_status: exception {e}, returning {result}")
            return result

    def ensure_loaded(self, background: bool = False) -> bool:
        """
        Check if the model is ready (server is up).
        Used by main.py startup warmup.
        """
        status = self.get_status()
        return status.get("status") == "ready"

    def transcribe_audio(self, audio_file_path: str) -> Dict[str, Any]:
        """
        Alias for transcribe to maintain compatibility with main.py calls.
        """
        # Add basic result validation/formatting if needed
        result = self.transcribe(audio_file_path)
        
        # Ensure 'transcription_success' key exists which main.py seems to check
        if "transcription_success" not in result:
             result["transcription_success"] = bool(result.get("text"))
        
        return result

    def transcribe_in_chunks(
        self,
        audio_path: str,
        chunk_sec: int = 3600,
        stride_sec: int = 60,
        language: Optional[str] = None,
        **kwargs
    ):
        """
        Generator-based transcription for compatibility with pipeline_orchestrator.

        Since whisper.cpp server doesn't support streaming, this method performs
        a single transcription and yields the result as one chunk, then returns
        the final summary.

        Args:
            audio_path: Path to audio file
            chunk_sec: Chunk size in seconds (ignored for whisper.cpp)
            stride_sec: Stride/overlap in seconds (ignored for whisper.cpp)
            language: Optional language code
            **kwargs: Additional options passed to transcribe

        Yields:
            Dict with partial transcription result

        Returns:
            Final summary dict via StopIteration.value
        """
        from datetime import datetime

        logger.info(f"transcribe_in_chunks called for {audio_path} (whisper.cpp single-pass mode)")

        # Perform single transcription (whisper.cpp doesn't support chunked streaming)
        result = self.transcribe(audio_path, language=language, **kwargs)

        # Build partial result
        partial = {
            "text": result.get("text", ""),
            "chunk_index": 0,
            "is_final": True,
            "language": result.get("language", "unknown"),
            "segments": result.get("segments", []),
        }

        # Yield the single chunk
        yield partial

        # Return final summary (captured via StopIteration.value by caller)
        return {
            "audio_path": audio_path,
            "transcription_success": bool(result.get("text")),
            "text": result.get("text", ""),
            "language": result.get("language", "unknown"),
            "segments": result.get("segments", []),
            "transcription_timestamp": datetime.now().isoformat(),
            "model_used": "whisper.cpp",
            "device_used": "cpu",  # whisper.cpp uses Metal but reports as local
            "backend": "whisper.cpp",
        }

    def save_transcript(self, call_id: str, transcript_data: Dict[str, Any]) -> Dict[str, str]:
        """
        Save transcript to JSON file (compatibility method).
        mirroring logic from old local_whisper.py
        """
        # Define output path under the desktop data dir when available.
        data_dir = os.getenv("TRANSCRIPTAI_DATA_DIR")
        if data_dir:
            base_dir = Path(data_dir)
        else:
            # Fall back to the configured upload dir's parent to keep files writable.
            try:
                base_dir = Path(settings.upload_dir).resolve().parent
            except Exception:
                base_dir = Path.cwd()
        transcript_dir = base_dir / "transcripts"
        transcript_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{call_id}.json"
        path = transcript_dir / filename

        # Save
        with open(path, "w") as f:
            json.dump(transcript_data, f, indent=2)

        return {"transcript_path": str(path.absolute())}
