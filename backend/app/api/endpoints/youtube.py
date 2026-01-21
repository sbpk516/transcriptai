
import uuid
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...services.youtube_service import YouTubeService
from ...database import get_db
from ...models import Call, Transcript
from ...db_integration import db_integration

router = APIRouter()
youtube_service = YouTubeService()
logger = logging.getLogger(__name__)


class YouTubeRequest(BaseModel):
    url: str


@router.post("/transcribe")
async def transcribe_youtube(request: YouTubeRequest):
    """
    Transcribe a YouTube video.
    First tries to get existing captions (Fast Path).
    If unavailable, downloads audio and transcribes via Whisper (Slow Path).

    Creates a Call record for analytics tracking.
    """
    try:
        result = await youtube_service.process_video(request.url)

        # Create Call record for analytics tracking
        call_id = str(uuid.uuid4())
        db_session = None
        try:
            db_session = next(get_db())

            # Extract duration from result (in seconds)
            duration = result.get("duration", 0)
            if isinstance(duration, float):
                duration = int(duration)

            # Create Call record with YouTube source
            call = Call(
                call_id=call_id,
                source_type="youtube",
                youtube_url=request.url,
                youtube_title=result.get("title", "YouTube Video"),
                duration=duration,
                status="completed",
                file_path=None,  # No local file for YouTube
            )
            db_session.add(call)
            db_session.commit()

            # Store transcript
            transcript_text = result.get("text", "")
            if transcript_text:
                transcript = Transcript(
                    call_id=call_id,
                    text=transcript_text,
                    language="en",
                )
                db_session.add(transcript)
                db_session.commit()

            logger.info(f"[YOUTUBE] Created Call record {call_id} for {request.url}")

            # Add call_id to result for reference
            result["call_id"] = call_id

        except Exception as e:
            logger.warning(f"[YOUTUBE] Failed to create Call record: {e}")
            if db_session:
                db_session.rollback()
        finally:
            if db_session:
                db_session.close()

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
