
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ...services.youtube_service import YouTubeService

router = APIRouter()
youtube_service = YouTubeService()

class YouTubeRequest(BaseModel):
    url: str

@router.post("/transcribe")
async def transcribe_youtube(request: YouTubeRequest):
    """
    Transcribe a YouTube video. 
    First tries to get existing captions (Fast Path).
    If unavailable, downloads audio and transcribes via Whisper (Slow Path).
    """
    try:
        result = await youtube_service.process_video(request.url)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
