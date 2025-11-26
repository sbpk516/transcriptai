#!/bin/bash

# Automatic log analyzer for dictation timeout issues

LOG_FILE="$HOME/Library/Application Support/TranscriptAI/logs/desktop.log"

echo "════════════════════════════════════════════════════════════"
echo " DICTATION LOG ANALYZER"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ ! -f "$LOG_FILE" ]; then
  echo "❌ No log file found at: $LOG_FILE"
  echo ""
  echo "This means either:"
  echo "  1. The app hasn't been launched yet"
  echo "  2. The app failed to start the backend"
  echo "  3. The log directory wasn't created"
  echo ""
  echo "Please launch the app first:"
  echo "  open /Users/bsachi867/Documents/ai_ground/transcriptai/desktop/dist/mac-arm64/TranscriptAI.app"
  echo ""
  exit 1
fi

echo "✅ Log file found: $LOG_FILE"
echo "📊 Log size: $(du -h "$LOG_FILE" | cut -f1)"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " 1. BACKEND STARTUP"
echo "═══════════════════════════════════════════════════════════"
grep "spawn_backend" "$LOG_FILE" | tail -5
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " 2. WHISPER INITIALIZATION (KEY: Check device!)"
echo "═══════════════════════════════════════════════════════════"
grep -i "whisper processor initialized" "$LOG_FILE" | tail -3
if grep -q "on mps" "$LOG_FILE"; then
  echo "✅ MPS DETECTED! Backend is using Apple Silicon GPU"
elif grep -q "on cuda" "$LOG_FILE"; then
  echo "ℹ️  CUDA detected (NVIDIA GPU)"
elif grep -q "on cpu" "$LOG_FILE"; then
  echo "❌ CPU ONLY! Backend is NOT using GPU acceleration"
  echo "   → This will cause 15-20s transcription times"
  echo "   → Upload will timeout (8s limit)"
else
  echo "⚠️  Could not find Whisper initialization in logs"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " 3. TRANSCRIPTION REQUESTS"
echo "═══════════════════════════════════════════════════════════"
grep -E "POST /api/v1/dictation/transcribe|transcription_completed" "$LOG_FILE" | tail -10
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " 4. BACKEND ERRORS (if any)"
echo "═══════════════════════════════════════════════════════════"
grep -i "error\|exception\|failed\|timeout" "$LOG_FILE" | tail -10
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " 5. TIMING ANALYSIS"
echo "═══════════════════════════════════════════════════════════"

# Extract transcription durations if available
if grep -q "elapsed_ms\|duration_ms" "$LOG_FILE"; then
  echo "Transcription durations found:"
  grep -oE "elapsed_ms[^,}]*|duration_ms[^,}]*" "$LOG_FILE" | tail -5
else
  echo "⚠️  No timing information found in logs"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo " DIAGNOSIS"
echo "═══════════════════════════════════════════════════════════"

if grep -q "on mps" "$LOG_FILE"; then
  echo "🎯 MPS is working! Likely issue:"
  echo "   - First transcription: 5-8s (model load + transcription)"
  echo "   - Timeout: 8s"
  echo "   - Result: Barely exceeds timeout on first try"
  echo ""
  echo "💡 SOLUTION: Increase timeout to 12-15 seconds"
  echo ""
elif grep -q "on cpu" "$LOG_FILE"; then
  echo "❌ CPU-only mode! This is the problem:"
  echo "   - Transcription: 15-20s"
  echo "   - Timeout: 8s"
  echo "   - Result: Always times out"
  echo ""
  echo "💡 SOLUTION: Backend binary needs rebuild with MPS code,"
  echo "   OR Torch/MPS not available/installed"
  echo ""
else
  echo "⚠️  Could not determine device. Check logs manually:"
  echo "   tail -100 \"$LOG_FILE\""
  echo ""
fi

echo "════════════════════════════════════════════════════════════"
echo ""
echo "For full logs:"
echo "  tail -100 \"$LOG_FILE\""
echo ""






