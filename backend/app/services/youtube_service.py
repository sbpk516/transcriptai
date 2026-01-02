
import os
import logging
import re
import uuid
import asyncio
from typing import Optional, Dict, Any, List
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
from pathlib import Path

# Local imports
from ..whisper_processor import WhisperProcessor

logger = logging.getLogger(__name__)

class YouTubeService:
    def __init__(self):
        self.whisper_processor = WhisperProcessor()
        # Temp dir for audio downloads
        self.download_dir = Path("/tmp/transcriptai_yt")
        self.download_dir.mkdir(parents=True, exist_ok=True)

    def _extract_video_id(self, url: str) -> Optional[str]:
        """Extracts video ID from various YouTube URL formats."""
        # Simple regex for standard and short URLs
        patterns = [
            r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
            r'(?:youtu\.be\/)([0-9A-Za-z_-]{11})'
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def get_video_title(self, url: str) -> str:
        """Fetch video title using yt-dlp (lightweight)."""
        try:
            with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
                info = ydl.extract_info(url, download=False)
                return info.get('title', 'YouTube Video')
        except Exception:
            return "YouTube Video"

    async def _download_audio(self, url: str, video_id: str) -> str:
        """Download audio via yt-dlp and convert to compatible WAV."""
        output_file = self.download_dir / f"{video_id}.wav"
        
        # If exists efficiently, skip? No, might be partial.
        # But for now, let's just overwrite.
        if output_file.exists():
            os.remove(output_file)

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': str(output_file.with_suffix('')), # yt-dlp adds extension
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'postprocessor_args': [
                '-ar', '16000',
                '-ac', '1',
                '-c:a', 'pcm_s16le'
            ],
            'quiet': True,
            'no_warnings': True
        }

        loop = asyncio.get_event_loop()
        # yt-dlp is blocking, run in executor
        await loop.run_in_executor(None, lambda: self._run_ytdlp(ydl_opts, url))
        
        return str(output_file)

    def _run_ytdlp(self, opts, url):
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

    async def process_video(self, url: str) -> Dict[str, Any]:
        """
        Main Entry Point:
        1. Try fetching existing captions (FAST).
        2. Fallback to downloading audio & Whisper (SLOW).
        """
        video_id = self._extract_video_id(url)
        if not video_id:
            raise ValueError("Invalid YouTube URL")

        title = self.get_video_title(url)
        logger.info(f"Processing YouTube Video: {title} ({video_id})")

        # Path 1: Fast Path (Existing Captions)
        try:
            logger.info("Attempting Fast Path: youtube-transcript-api v1.2.3")
            # v1.2.3 uses instance method fetch()
            yt_api = YouTubeTranscriptApi()
            transcript_obj = yt_api.fetch(video_id)
            
            # transcript_obj has .snippets attribute with FetchedTranscriptSnippet objects
            # Each snippet has .text, .start, .duration attributes
            transcript_list = []
            for snippet in transcript_obj.snippets:
                transcript_list.append({
                    'text': snippet.text,
                    'start': snippet.start,
                    'duration': snippet.duration
                })
            
            # Build full text from snippets
            full_text = " ".join([item['text'] for item in transcript_list])
            
            # Calculate total duration from last segment
            duration = 0
            if transcript_list:
                last = transcript_list[-1]
                duration = last['start'] + last['duration']
            
            logger.info(f"Successfully retrieved transcript from YouTube API (duration: {duration:.1f}s, segments: {len(transcript_list)})")
            
            return {
                "source": "youtube_api",
                "title": title,
                "text": full_text,
                "segments": transcript_list,
                "duration": duration
            }

        except Exception as e:
            error_msg = str(e)
            logger.warning(f"Fast Path failed: {error_msg}")
            logger.warning(f"Error type: {type(e).__name__}")
            
            # Check if it's a "no transcripts available" error
            if "transcript" in error_msg.lower() or "subtitle" in error_msg.lower() or "caption" in error_msg.lower():
                raise ValueError(f"No captions/transcripts available for this video. Error: {error_msg}")
            elif "private" in error_msg.lower() or "unavailable" in error_msg.lower():
                raise ValueError(f"Video is private or unavailable. Error: {error_msg}")
            
            # For other errors, try the slow path
            logger.info("Attempting Slow Path: Download + Whisper")

        # Path 2: Slow Path (Download + Whisper)
        try:
            audio_path = await self._download_audio(url, video_id)
        except Exception as download_error:
            error_msg = str(download_error)
            logger.error(f"Failed to download YouTube video: {error_msg}")
            
            # Provide helpful error messages
            if "403" in error_msg or "Forbidden" in error_msg:
                raise ValueError("YouTube blocked the download (HTTP 403). This video cannot be downloaded. Please try a different video or ensure it has captions available.")
            elif "400" in error_msg or "Bad Request" in error_msg:
                raise ValueError("YouTube rejected the download request (HTTP 400). The video may have restrictions or yt-dlp needs updating.")
            else:
                raise ValueError(f"Failed to download video audio: {error_msg}")
        
        try:
            # Call C++ Whisper Client
            # Note: This is synchronous network call, blocking. 
            # In production, should be async or in thread.
            result = self.whisper_processor.transcribe(audio_path)
            
            # Enrich
            result["source"] = "whisper_cpp"
            result["title"] = title
            return result
            
        finally:
            # Cleanup audio
            if os.path.exists(audio_path):
                os.remove(audio_path)
