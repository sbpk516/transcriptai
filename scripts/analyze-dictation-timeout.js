#!/usr/bin/env node

/**
 * Analyze dictation timeout issue
 * 
 * This script parses the browser console logs to understand:
 * 1. When chunks are captured
 * 2. When upload starts
 * 3. How long each attempt takes
 * 4. Why it's being cancelled
 */

console.log('════════════════════════════════════════════════════════════')
console.log(' DICTATION TIMEOUT ANALYSIS')
console.log('════════════════════════════════════════════════════════════')
console.log('')

console.log('📊 Known Facts:')
console.log('   - Upload timeout: 8 seconds (DEFAULT_TIMEOUT_MS)')
console.log('   - Retry attempts: 3 (DEFAULT_MAX_ATTEMPTS)')
console.log('   - Backend should be using MPS (Apple Silicon GPU)')
console.log('   - Expected transcription time: 2-3s with MPS')
console.log('   - First transcription: +3-5s for model loading')
console.log('')

console.log('🔍 Possible Causes of "request cancelled":')
console.log('   1. Backend taking > 8 seconds (timeout)')
console.log('   2. Backend not using MPS (still CPU-only)')
console.log('   3. Model loading on every request (not cached)')
console.log('   4. External abort signal triggered')
console.log('   5. User pressing shortcut again while processing')
console.log('')

console.log('🎯 Root Cause Hypothesis:')
console.log('   FIRST transcription after app launch:')
console.log('   - Model load: ~3-5 seconds')
console.log('   - Transcription: ~2-3 seconds')
console.log('   - TOTAL: ~5-8 seconds (at the edge of timeout!)')
console.log('')
console.log('   If backend is still CPU-only:')
console.log('   - Model load: ~3-5 seconds')
console.log('   - Transcription: ~15 seconds')
console.log('   - TOTAL: ~18-20 seconds (GUARANTEED timeout!)')
console.log('')

console.log('═══════════════════════════════════════════════════════════')
console.log(' DIAGNOSTIC STEPS:')
console.log('═══════════════════════════════════════════════════════════')
console.log('1. Close TranscriptAI (Cmd+Q)')
console.log('2. Clear logs:')
console.log('   rm -f ~/Library/Application\\ Support/TranscriptAI/logs/desktop.log')
console.log('')
console.log('3. Launch app:')
console.log('   open /Users/bsachi867/Documents/ai_ground/transcriptai/desktop/dist/mac-arm64/TranscriptAI.app')
console.log('')
console.log('4. Wait 3 seconds for backend to start')
console.log('')
console.log('5. Open browser DevTools (Cmd+Option+I)')
console.log('')
console.log('6. Try push-to-talk ONCE:')
console.log('   - Hold CMD+Option')
console.log('   - Speak 2-3 seconds')
console.log('   - Release')
console.log('')
console.log('7. Immediately check logs:')
console.log('   tail -100 ~/Library/Application\\ Support/TranscriptAI/logs/desktop.log | grep -E "whisper|mps|device|transcrib|attempt"')
console.log('')
console.log('8. Look for these KEY indicators:')
console.log('   ✅ "Whisper processor initialized with model: base on mps"')
console.log('   ❌ "Whisper processor initialized with model: base on cpu"')
console.log('   ✅ "transcription completed" with duration < 5s')
console.log('   ❌ "transcription completed" with duration > 10s')
console.log('')
console.log('═══════════════════════════════════════════════════════════')
console.log(' EXPECTED OUTCOMES:')
console.log('═══════════════════════════════════════════════════════════')
console.log('Scenario A: MPS Working')
console.log('   - First attempt: ~5-8s (may succeed or barely timeout)')
console.log('   - Second attempt: ~2-3s (should succeed)')
console.log('   - Solution: Increase timeout to 12-15s')
console.log('')
console.log('Scenario B: Still CPU-only')
console.log('   - All attempts: ~15-20s (all timeout)')
console.log('   - Solution: Backend binary needs rebuild OR MPS not activating')
console.log('')
console.log('Scenario C: Model loading every time')
console.log('   - Every attempt: ~5-8s (inconsistent)')
console.log('   - Solution: Model caching issue')
console.log('')
console.log('═══════════════════════════════════════════════════════════')
console.log('')
console.log('Ready to diagnose? Follow steps above.')
console.log('')






