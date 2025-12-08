
import json
import os
import sys

log_dir = os.path.expanduser("~/Library/Application Support/TranscriptAI/logs")
# Find latest error log
try:
    files = [f for f in os.listdir(log_dir) if f.startswith("error_whisper_model")]
    if not files:
        print("No error logs found")
        sys.exit(0)
        
    latest = max(files, key=lambda f: os.path.getmtime(os.path.join(log_dir, f)))
    path = os.path.join(log_dir, latest)
    print(f"Reading: {path}")
    
    with open(path) as f:
        data = json.load(f)
        print(f"Error Message: {data.get('error', 'N/A')}")
        print(f"Context: {data.get('context', {})}")
        if 'traceback' in data:
            print("Traceback (last 3 lines):")
            print('\n'.join(data['traceback'].split('\n')[-3:]))
            
except Exception as e:
    print(f"Failed: {e}")
