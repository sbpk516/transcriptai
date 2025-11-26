#!/bin/bash
# Start backend for web app testing with all features enabled

set -e

cd "$(dirname "$0")/.."

# Set environment variables for web mode
export DATABASE_URL="sqlite:///$HOME/Library/Application Support/TranscriptAI/transcriptai.db"
export TRANSCRIPTAI_LIVE_MIC=1
export TRANSCRIPTAI_LIVE_TRANSCRIPTION=1
export TRANSCRIPTAI_ENABLE_TRANSCRIPTION=1

# Create data directory if it doesn't exist
mkdir -p "$HOME/Library/Application Support/TranscriptAI"

echo "Starting backend for web app..."
echo "  Database: SQLite"
echo "  Live Mic: Enabled"
echo "  Live Transcription: Enabled"
echo ""

cd backend
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload











