
from youtube_transcript_api import YouTubeTranscriptApi
import logging

try:
    # api = YouTubeTranscriptApi()
    # Using TED talk ID
    video_id = "iG9CE55wbtY"
    
    print(f"Fetching {video_id}...")
    import time
    
    # Measure Title Fetch (yt-dlp)
    import yt_dlp
    t0 = time.time()
    print("Fetching title with yt-dlp...")
    with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
         info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
         print(f"Title: {info.get('title')}")
    t1 = time.time()
    print(f"Title fetch took {t1 - t0:.2f}s")

    t_api_start = time.time()
    # v1.2.3 usage
    api = YouTubeTranscriptApi()
    result = api.fetch(video_id)
    t_api_end = time.time()
    print(f"Transcript fetch took {t_api_end - t_api_start:.2f}s")
    
    print(f"Type: {type(result)}")
    # In v1.2.3 presumably result is an object with snippets?
    # Let's inspect it.
    if hasattr(result, 'snippets'):
        print(f"Has snippets: {len(result.snippets)}")
        if len(result.snippets) > 0:
            print(f"First snippet: {result.snippets[0]}")
    else:
        print(f"Result content: {result}")
    
except Exception as e:
    print(f"Error: {e}")
