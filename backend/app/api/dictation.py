"""Dictation API endpoints."""
from typing import Optional
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..whisper_backend_selector import get_global_whisper_processor
from pydantic import BaseModel, Field

# Get the appropriate Whisper processor (PyTorch or MLX)
whisper_processor = get_global_whisper_processor()
logger = logging.getLogger("transcriptai.dictation")

router = APIRouter(prefix="/dictation", tags=["dictation"])


class DictationSnippet(BaseModel):
    """Payload for short-form dictation transcription."""

    audio_base64: str = Field(..., description="Base64-encoded audio snippet")
    sample_rate: Optional[int] = Field(None, description="Sample rate of the snippet in Hz")
    media_type: Optional[str] = Field(
        "audio/wav",
        description="Media (MIME) type of the snippet. Defaults to audio/wav.",
    )


MAX_SNIPPET_DURATION_MS = 120 * 1000  # 2 minutes
ALLOWED_MEDIA_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/webm",
}


class DictationResponse(BaseModel):
    """Response returned after transcription."""

    text: str = Field(..., description="Transcribed text")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score (0-1)")
    duration_ms: int = Field(..., ge=0, description="Duration of the snippet in milliseconds")


_FIRST_SNIPPET_LOG_LIMIT = 5
_first_snippet_counter = 0


@router.post("/transcribe", response_model=DictationResponse, summary="Transcribe a short audio snippet")
async def transcribe_snippet(request: DictationSnippet) -> DictationResponse:
    """Transcribe an audio snippet and return the text + metadata."""

    # Normalize media_type by stripping codec info (e.g., "audio/webm;codecs=opus" -> "audio/webm")
    normalized_media_type = request.media_type
    if normalized_media_type:
        normalized_media_type = normalized_media_type.split(';')[0].strip().lower()
        if normalized_media_type not in ALLOWED_MEDIA_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported media_type")

    global _first_snippet_counter

    try:
        result = whisper_processor.transcribe_snippet_from_base64(
            request.audio_base64,
            media_type=normalized_media_type or "audio/wav",
            sample_rate=request.sample_rate,
            max_duration_ms=MAX_SNIPPET_DURATION_MS,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if _first_snippet_counter < _FIRST_SNIPPET_LOG_LIMIT:
        _first_snippet_counter += 1
        snippet_no = _first_snippet_counter
        try:
            logger.info(
                "[DICTATION] sample=%d media=%s char_len=%d first_chars=%r",
                snippet_no,
                normalized_media_type or "audio/wav",
                len(result.get("text", "")),
                (result.get("text", "") or "")[:80],
            )
        except Exception:
            pass

    return DictationResponse(**result)


class WarmupResponse(BaseModel):
    status: str
    whisper_loaded: bool


@router.post("/warmup", response_model=WarmupResponse, summary="Ensure dictation models are warm")
async def warmup_models() -> WarmupResponse:
    try:
        # ensuring loaded is important to trigger loading if not loaded
        whisper_processor.ensure_loaded()
        
        # Check actual status
        status_info = whisper_processor.get_status()
        
        # Determine if loaded
        is_loaded = status_info.get("status") == "ready"
            
    except Exception as exc:
        logger.error("[DICTATION] warmup_failed error=%s", exc)
        raise HTTPException(status_code=500, detail="Failed to warm up speech model") from exc

    logger.info("[DICTATION] warmup status=complete is_loaded=%s", is_loaded)
    return WarmupResponse(status="ok", whisper_loaded=is_loaded)
