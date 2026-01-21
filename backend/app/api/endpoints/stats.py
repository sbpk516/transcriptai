"""
Transcription statistics API endpoint.

TRAN-10: GET /api/v1/stats endpoint
TRAN-11: Pydantic models for stats response
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import Call

router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================================================
# TRAN-11: Pydantic models for stats response
# ============================================================================

class SourceStats(BaseModel):
    """Statistics for a single source type."""
    minutes: float
    count: int


class TranscriptionStatsResponse(BaseModel):
    """Response model for transcription statistics endpoint."""
    audioFiles: SourceStats
    liveRecordings: SourceStats
    youtubeVideos: SourceStats


# ============================================================================
# TRAN-10: GET /api/v1/stats endpoint
# ============================================================================

@router.get("", response_model=TranscriptionStatsResponse)
async def get_transcription_stats(db: Session = Depends(get_db)) -> TranscriptionStatsResponse:
    """
    Get transcription statistics grouped by source type.

    Returns total minutes and count for each source type:
    - audioFiles: Uploaded audio files
    - liveRecordings: Live microphone recordings
    - youtubeVideos: YouTube video transcriptions
    """
    try:
        # Query stats for each source type
        # Using SQL aggregation for efficiency
        stats_query = (
            db.query(
                Call.source_type,
                func.coalesce(func.sum(Call.duration), 0).label("total_seconds"),
                func.count(Call.id).label("count"),
            )
            .filter(Call.status == "completed")
            .group_by(Call.source_type)
            .all()
        )

        # Initialize default values
        stats_by_source = {
            "upload": {"seconds": 0, "count": 0},
            "live": {"seconds": 0, "count": 0},
            "youtube": {"seconds": 0, "count": 0},
        }

        # Populate from query results
        for row in stats_query:
            source_type = row.source_type or "upload"
            if source_type in stats_by_source:
                stats_by_source[source_type] = {
                    "seconds": row.total_seconds or 0,
                    "count": row.count or 0,
                }

        # Convert seconds to minutes and build response
        response = TranscriptionStatsResponse(
            audioFiles=SourceStats(
                minutes=round(stats_by_source["upload"]["seconds"] / 60, 1),
                count=stats_by_source["upload"]["count"],
            ),
            liveRecordings=SourceStats(
                minutes=round(stats_by_source["live"]["seconds"] / 60, 1),
                count=stats_by_source["live"]["count"],
            ),
            youtubeVideos=SourceStats(
                minutes=round(stats_by_source["youtube"]["seconds"] / 60, 1),
                count=stats_by_source["youtube"]["count"],
            ),
        )

        logger.info(
            f"[STATS] Retrieved stats: uploads={response.audioFiles.count}, "
            f"live={response.liveRecordings.count}, youtube={response.youtubeVideos.count}"
        )

        return response

    except Exception as e:
        logger.error(f"[STATS] Failed to retrieve stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve stats: {str(e)}")
