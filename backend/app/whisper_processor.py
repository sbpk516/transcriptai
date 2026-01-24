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


# =============================================================================
# Post-processing deduplication functions (safety net for hallucinations)
# =============================================================================

def remove_repeated_ngrams(text: str, n_gram_size: int = 5, max_repetitions: int = 1) -> str:
    """
    Remove repeated n-grams from transcription output.

    Args:
        text: Input transcription text
        n_gram_size: Size of n-grams to detect (default 5 words - catches shorter phrases)
        max_repetitions: Maximum allowed repetitions before removal (default 1)

    Returns:
        Cleaned text with excessive repetitions removed
    """
    if not text or not text.strip():
        return text

    words = text.split()
    if len(words) < n_gram_size * 2:
        return text  # Too short to have meaningful repetitions

    result = []
    i = 0
    seen_ngrams = {}

    while i < len(words):
        ngram = tuple(words[i:i + n_gram_size])

        if len(ngram) < n_gram_size:
            result.extend(words[i:])
            break

        ngram_key = ' '.join(ngram).lower()
        seen_ngrams[ngram_key] = seen_ngrams.get(ngram_key, 0) + 1

        if seen_ngrams[ngram_key] <= max_repetitions:
            # First occurrence - keep this word and advance by 1
            result.append(words[i])
            i += 1
        else:
            # Repeated n-gram detected - skip the entire n-gram
            logger.debug(f"Removing repeated n-gram: {ngram_key[:50]}...")
            i += n_gram_size

    cleaned = ' '.join(result)
    if len(cleaned) < len(text) * 0.9:
        logger.warning(f"Deduplication removed {len(text) - len(cleaned)} chars")

    return cleaned


def remove_duplicate_sentences(text: str) -> str:
    """
    Remove duplicate sentences from transcription output.

    Whisper often repeats entire sentences, especially in longer recordings.
    This function removes exact and near-duplicate sentences.

    Args:
        text: Input transcription text

    Returns:
        Text with duplicate sentences removed
    """
    import re

    if not text or not text.strip():
        return text

    # Split into sentences (handle . ! ? and newlines)
    sentence_pattern = r'(?<=[.!?])\s+|\n+'
    sentences = re.split(sentence_pattern, text)

    seen_sentences = set()
    result = []
    duplicates_removed = 0

    for sentence in sentences:
        # Normalize for comparison (lowercase, strip punctuation/whitespace)
        normalized = sentence.lower().strip()
        normalized = re.sub(r'[^\w\s]', '', normalized)  # Remove punctuation
        normalized = ' '.join(normalized.split())  # Normalize whitespace

        if not normalized:
            continue

        if normalized not in seen_sentences:
            seen_sentences.add(normalized)
            result.append(sentence.strip())
        else:
            duplicates_removed += 1
            logger.debug(f"Removing duplicate sentence: {sentence[:50]}...")

    if duplicates_removed > 0:
        logger.info(f"Removed {duplicates_removed} duplicate sentences")

    return ' '.join(result)


def remove_partial_phrase_repeats(text: str, min_words: int = 4, max_words: int = 15) -> str:
    """
    Remove partial phrase repetitions that occur close together.

    Catches patterns like:
    "I'm testing whether this works... I'm testing whether this"
    Where the second phrase is a partial repeat of the first.

    Args:
        text: Input transcription text
        min_words: Minimum phrase length to check
        max_words: Maximum phrase length to check

    Returns:
        Text with partial repeats removed
    """
    if not text or not text.strip():
        return text

    words = text.split()
    if len(words) < min_words * 2:
        return text

    result = []
    i = 0
    removed_count = 0

    while i < len(words):
        # Check if current position starts a phrase that was seen recently
        found_repeat = False

        for phrase_len in range(max_words, min_words - 1, -1):
            if i + phrase_len > len(words):
                continue

            current_phrase = ' '.join(words[i:i + phrase_len]).lower()

            # Look back in result to see if this phrase (or similar) already exists
            result_text = ' '.join(result).lower()

            # Check if the current phrase appears in the last portion of result
            # (within last 50 words to avoid false positives)
            lookback_start = max(0, len(result) - 50)
            lookback_text = ' '.join(result[lookback_start:]).lower()

            if current_phrase in lookback_text:
                # Found a repeat - skip this phrase
                logger.debug(f"Removing partial repeat: '{current_phrase[:40]}...'")
                i += phrase_len
                removed_count += 1
                found_repeat = True
                break

        if not found_repeat:
            result.append(words[i])
            i += 1

    if removed_count > 0:
        logger.info(f"Removed {removed_count} partial phrase repeats")

    return ' '.join(result)


def remove_consecutive_duplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Remove consecutive duplicate segments from transcription output.

    Args:
        segments: List of segment dicts with 'text' field

    Returns:
        Cleaned list with consecutive duplicates removed
    """
    if not segments:
        return segments

    cleaned = [segments[0]]
    duplicates_removed = 0

    for seg in segments[1:]:
        current_text = seg.get('text', '').strip().lower()
        previous_text = cleaned[-1].get('text', '').strip().lower()

        if current_text and current_text != previous_text:
            if not (len(current_text) > 10 and current_text in previous_text):
                cleaned.append(seg)
            else:
                duplicates_removed += 1
        else:
            duplicates_removed += 1

    if duplicates_removed > 0:
        logger.info(f"Removed {duplicates_removed} duplicate segments")

    return cleaned


def remove_trailing_repetition(text: str, min_phrase_words: int = 3, max_phrase_words: int = 10) -> str:
    """
    Remove repeated phrases at the end of transcription.

    Whisper often hallucinates by repeating a phrase at the end of audio,
    especially when there's trailing silence. This function detects and removes
    such trailing repetitions.

    Args:
        text: Input transcription text
        min_phrase_words: Minimum phrase length to check (default 3 words)
        max_phrase_words: Maximum phrase length to check (default 10 words)

    Returns:
        Text with trailing repetitions removed
    """
    if not text or not text.strip():
        return text

    words = text.split()
    if len(words) < min_phrase_words * 2:
        return text

    # Check for trailing repetitions of various lengths
    for phrase_len in range(min_phrase_words, min(max_phrase_words + 1, len(words) // 2 + 1)):
        # Get the last N words (potential repeated phrase)
        trailing_phrase = ' '.join(words[-phrase_len:]).lower().strip('.,!?')

        # Look for this phrase earlier in the text
        text_without_trailing = ' '.join(words[:-phrase_len])

        # Check if the trailing phrase appears near the end of the remaining text
        # (within the last 30% of the text)
        remaining_words = words[:-phrase_len]
        search_start = max(0, len(remaining_words) - int(len(remaining_words) * 0.3) - phrase_len)
        search_region = ' '.join(remaining_words[search_start:]).lower()

        if trailing_phrase in search_region:
            # Found a repetition - remove the trailing phrase
            cleaned = ' '.join(words[:-phrase_len])
            logger.info(f"Removed trailing repetition: '{' '.join(words[-phrase_len:])}'")
            return cleaned

    return text


def deduplicate_transcription(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Apply all deduplication strategies to transcription result.
    Always enabled as a safety net against whisper hallucinations.

    Args:
        result: Transcription result dict with 'text' and optionally 'segments'

    Returns:
        Cleaned transcription result
    """
    if not result or result.get('error'):
        return result

    # 1. Segment deduplication (safe - always ON)
    segments = result.get('segments', [])
    if segments:
        result['segments'] = remove_consecutive_duplicate_segments(segments)

    # 2. Sentence-level deduplication (catches repeated full sentences)
    original_text = result.get('text', '')
    if original_text:
        result['text'] = remove_duplicate_sentences(original_text)

    # 3. Partial phrase repeat removal (catches "phrase... phrase" patterns)
    if result.get('text'):
        result['text'] = remove_partial_phrase_repeats(result['text'])

    # 4. N-gram text deduplication (5 words, max 1 repetition - catches remaining phrase repeats)
    if result.get('text'):
        result['text'] = remove_repeated_ngrams(result['text'])

    # 5. Trailing repetition removal (catches short phrases repeated at end)
    if result.get('text'):
        result['text'] = remove_trailing_repetition(result['text'])

    return result


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
        
        # Prepare params with anti-hallucination settings
        # Reference: https://github.com/ggml-org/whisper.cpp/discussions/1490
        data = {
            "response_format": "json",
            "temperature": kwargs.get("temperature", 0.0),

            # Anti-hallucination / duplicate prevention parameters
            "entropy_threshold": kwargs.get("entropy_threshold", 2.2),       # Reject high-entropy output (lower = stricter)
            "logprob_threshold": kwargs.get("logprob_threshold", -0.5),      # Reject low-confidence output (higher = stricter)
            "no_speech_threshold": kwargs.get("no_speech_threshold", 0.5),   # Better silence detection
            "suppress_blank": "true",                                         # Suppress blank outputs
            "suppress_non_speech_tokens": "true",                             # Filter non-speech tokens

            # Key parameters to prevent repetition loops
            "max_context": kwargs.get("max_context", 0),                      # Disable context carry-over (prevents loops)
            "beam_size": kwargs.get("beam_size", 5),                          # Better decoding accuracy
            "condition_on_previous_text": "false",                            # Don't let previous text influence current

            # Additional repetition prevention
            "word_timestamps": "true",                                        # Enable word-level timestamps for better segmentation
            "split_on_word": "true",                                          # Split on word boundaries
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
            logger.debug(f"Transcription result: {result}")
            
            # Normalize response to match expected output structure
            # whisper.cpp server usually returns { "text": "...", "segments": [...] }
            # If keys are missing, fill them.
            if "text" not in result:
                logger.warning(f"Whisper server response missing 'text' field: {result}")
                result["text"] = "" 
            
            if not result["text"].strip():
                logger.warning(f"Whisper server returned empty text for {audio_file}")

            # Apply post-processing deduplication (safety net for hallucinations)
            return deduplicate_transcription(result)

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

    def load_model(self, model_path: str) -> Dict[str, Any]:
        """
        Load a different model at runtime via the whisper.cpp server's /load endpoint.

        Args:
            model_path: Full path to the model file (e.g., /path/to/ggml-small.en.bin)

        Returns:
            Dict with status and any error info
        """
        url = f"{self.base_url}/load"
        logger.info(f"Loading model via {url}: {model_path}")

        try:
            response = requests.post(
                url,
                json={"model": model_path},
                timeout=120  # Model loading can take time
            )
            response.raise_for_status()

            # Update internal model name
            model_name = Path(model_path).stem  # e.g., "ggml-small.en" -> extract "small"
            for name in ["tiny", "base", "small", "medium", "large"]:
                if name in model_name:
                    self.model_name = name
                    break

            logger.info(f"Model loaded successfully: {model_path}")
            return {"status": "ok", "model_path": model_path}

        except requests.exceptions.ConnectionError as e:
            error_msg = f"Connection failed to Whisper Server at {url}"
            logger.error(error_msg)
            return {"status": "error", "error": error_msg}
        except requests.exceptions.Timeout as e:
            error_msg = f"Timeout loading model at {url}"
            logger.error(error_msg)
            return {"status": "error", "error": error_msg}
        except requests.exceptions.HTTPError as e:
            error_msg = f"HTTP error loading model: {e.response.status_code} - {e.response.text}"
            logger.error(error_msg)
            return {"status": "error", "error": error_msg}
        except Exception as e:
            error_msg = f"Failed to load model: {e}"
            logger.error(error_msg)
            return {"status": "error", "error": str(e)}

    def get_status(self) -> Dict[str, Any]:
        """
        Check health of the C++ Whisper Server.
        """
        # whisper.cpp server doesn't have /health - check root endpoint instead
        url = f"{self.base_url}/"
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

    def transcribe_snippet_from_base64(
        self,
        audio_base64: str,
        media_type: str = "audio/wav",
        sample_rate: Optional[int] = None,
        max_duration_ms: int = 120000,
    ) -> Dict[str, Any]:
        """
        Transcribe a short audio snippet from base64 (Desktop PTT).
        Compatibility method to match MLX implementation but using C++ server.
        """
        import base64
        import tempfile
        import uuid
        from .audio_processor import audio_processor

        logger.info(f"[PTT] Processing base64 snippet: type={media_type}, rate={sample_rate}")

        # 1. Decode base64
        try:
            audio_data = base64.b64decode(audio_base64)
        except Exception as e:
            logger.error(f"[PTT] Failed to decode base64: {e}")
            raise ValueError(f"Invalid base64 audio data: {e}")

        # 2. Save to temp file
        # We use a unique name to avoid collisions
        ext = media_type.split("/")[-1] if "/" in media_type else "wav"
        if "webm" in ext:
            ext = "webm"
        
        temp_id = str(uuid.uuid4())[:8]
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # 3. Convert to mono 16k WAV if not already (Whisper requirement)
            # Webm particularly needs conversion
            conv_result = audio_processor.convert_audio_format(
                tmp_path,
                output_format="wav",
                sample_rate=16000,
                channels=1
            )
            
            final_path = conv_result.get("output_path") if conv_result.get("conversion_success") else tmp_path

            # 4. VAD check - skip silent snippets to prevent hallucinations
            from .config import is_vad_enabled
            if is_vad_enabled():
                try:
                    from .audio_enhancer import should_skip_chunk
                    if should_skip_chunk(final_path):
                        logger.info("[PTT] Skipping silent snippet (VAD detected no speech)")
                        return {
                            "text": "",
                            "confidence": 0.0,
                            "duration_ms": 0,
                            "skipped_reason": "no_speech"
                        }
                except Exception as e:
                    logger.warning(f"[PTT] VAD check failed, proceeding with transcription: {e}")

            # 5. Transcribe via existing method (calls C++ server)
            result = self.transcribe(final_path)

            # 6. Build response matching expected DictationResponse
            return {
                "text": result.get("text", "").strip(),
                "confidence": 1.0, # C++ server doesn't always provide per-snippet confidence
                "duration_ms": int(max_duration_ms), # Rough estimate or extracted from file if needed
            }

        finally:
            # Cleanup temp files
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                # If we have a processed output path from audio_processor, we should clean it too
                # but audio_processor manages its own processed_dir.
            except Exception as e:
                logger.warning(f"[PTT] Failed to cleanup temp files: {e}")
