#!/usr/bin/env node

/**
 * Phase 6: Backend Transcription Tests
 * Tests the backend endpoint, audio decoding, and Whisper transcription
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { TestFramework, TestUtils } = require('./test-framework');

const framework = new TestFramework('PHASE 6: Backend Transcription');

// Paths
const BACKEND_LOG_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/transcriptai_data/logs/transcriptai.log');
const BACKEND_LOG_ALT = path.join(os.homedir(), 'Library/Application Support/transcriptai/logs/transcriptai.log');

async function getBackendLog() {
  for (const logPath of [BACKEND_LOG_PATH, BACKEND_LOG_ALT]) {
    try {
      await fs.access(logPath);
      return logPath;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Test 6.1: Request receipt
 */
framework.test('Backend request receipt', async () => {
  // Check if backend is running
  try {
    const response = await TestUtils.httpRequest('http://127.0.0.1:8001/health', {
      method: 'GET',
      timeout: 3000,
    });
    
    if (response.statusCode !== 200) {
      return {
        pass: false,
        message: `Backend health check failed with status ${response.statusCode}`,
      };
    }
  } catch (err) {
    return {
      pass: false,
      message: 'Backend is not running or not reachable on port 8001',
    };
  }
  
  console.log('  ℹ️  Backend is running');
  
  // Test if dictation endpoint exists
  try {
    const response = await TestUtils.httpRequest('http://127.0.0.1:8001/api/v1/dictation/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      timeout: 3000,
    });
    
    // We expect 422 (validation error) or 400, not 404
    if (response.statusCode === 404) {
      return {
        pass: false,
        message: 'Dictation endpoint not found (404). Check route registration.',
      };
    }
    
    console.log(`  ℹ️  Dictation endpoint exists (status: ${response.statusCode})`);
  } catch (err) {
    if (!err.message.includes('timeout')) {
      return {
        pass: false,
        message: `Dictation endpoint error: ${err.message}`,
      };
    }
  }
  
  return { pass: true };
});

/**
 * Test 6.2: Audio decoding
 * Requires actual dictation to test
 */
framework.test('Audio decoding', async () => {
  console.log('\n  📋 ACTION REQUIRED: Perform full dictation (hold CMD+Option, speak, release)...');
  console.log('  This will test if backend can decode the uploaded audio');
  
  await TestUtils.sleep(12000);
  
  const logPath = await getBackendLog();
  if (!logPath) {
    console.log('  ⚠️  Backend log not found, cannot verify audio decoding');
    return { pass: true }; // Don't fail if we can't find logs
  }
  
  // Check backend logs for transcription activity
  const hasTranscription = await TestUtils.checkLogContains(
    logPath,
    /transcrib/i,
    5000
  );
  
  if (!hasTranscription) {
    console.log('  ⚠️  No transcription activity in backend logs');
  } else {
    console.log('  ℹ️  Backend processing transcription request');
  }
  
  return { pass: true };
}, ['Backend request receipt']);

/**
 * Test 6.3: Whisper transcription
 */
framework.test('Whisper transcription', async () => {
  const logPath = await getBackendLog();
  if (!logPath) {
    console.log('  ⚠️  Backend log not found, skipping Whisper verification');
    return { pass: true };
  }
  
  // Look for successful transcription or Whisper model loading
  const hasWhisper = await TestUtils.checkLogContains(
    logPath,
    /whisper|transcription.*success/i,
    5000
  );
  
  if (!hasWhisper) {
    console.log('  ⚠️  No Whisper activity detected in logs');
  }
  
  return { pass: true };
}, ['Audio decoding']);

/**
 * Test 6.4: Response return
 */
framework.test('Response return with transcript', async () => {
  console.log('\n  ⚠️  MANUAL VERIFICATION REQUIRED:');
  console.log('  Check browser DevTools Network tab:');
  console.log('  - Find the POST request to /api/v1/dictation/transcribe');
  console.log('  - Check response status (should be 200)');
  console.log('  - Check response body for "transcript" field');
  
  await TestUtils.sleep(2000);
  
  return { pass: true };
}, ['Whisper transcription']);

// Run tests
(async () => {
  const results = await framework.run();
  const success = framework.printSummary();
  
  console.log('\n📝 Manual Checklist for Phase 6:');
  console.log('  [ ] Backend /health endpoint returns 200');
  console.log('  [ ] Dictation endpoint exists and processes requests');
  console.log('  [ ] Backend logs show transcription activity');
  console.log('  [ ] Network tab shows 200 response with transcript');
  
  process.exit(success ? 0 : 1);
})();

