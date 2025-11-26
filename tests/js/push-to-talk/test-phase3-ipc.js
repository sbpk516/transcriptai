#!/usr/bin/env node

/**
 * Phase 3: IPC Bridge Tests
 * Tests the IPC communication between main and renderer processes
 */

const path = require('path');
const os = require('os');
const { TestFramework, TestUtils } = require('./test-framework');

const framework = new TestFramework('PHASE 3: IPC Bridge');

// Paths
const LOG_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/logs/desktop.log');

/**
 * Test 3.1: Permission granted event broadcast
 */
framework.test('Permission granted event broadcast', async () => {
  console.log('\n  📋 ACTION REQUIRED: Hold CMD+Option keys for 2 seconds then release...');
  
  await TestUtils.sleep(1000);
  
  // Check for permission granted broadcast in logs
  const hasGranted = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_permission_granted',
    15000
  );
  
  if (!hasGranted) {
    return {
      pass: false,
      message: 'Permission granted event not broadcast. Check dictation:permission-granted IPC.',
    };
  }
  
  return { pass: true };
});

/**
 * Test 3.2: Press-start event broadcast
 */
framework.test('Press-start event broadcast', async () => {
  // Check for press-start event in logs
  const hasStart = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_event_start',
    10000
  );
  
  if (!hasStart) {
    return {
      pass: false,
      message: 'Press-start event not broadcast. Check dictation:press-start emission and IPC.',
    };
  }
  
  return { pass: true };
}, ['Permission granted event broadcast']);

/**
 * Test 3.3: Press-end event broadcast
 */
framework.test('Press-end event broadcast', async () => {
  console.log('\n  📋 ACTION REQUIRED: Hold CMD+Option keys, then RELEASE them...');
  
  await TestUtils.sleep(3000);
  
  // Check for press-end event in logs
  const hasEnd = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_event_end',
    15000
  );
  
  if (!hasEnd) {
    return {
      pass: false,
      message: 'Press-end event not broadcast. Check keyup detection and dictation:press-end emission.',
    };
  }
  
  return { pass: true };
}, ['Press-start event broadcast']);

// Run tests
(async () => {
  const results = await framework.run();
  const success = framework.printSummary();
  process.exit(success ? 0 : 1);
})();

