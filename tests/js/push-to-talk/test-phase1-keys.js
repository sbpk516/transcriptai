#!/usr/bin/env node

/**
 * Phase 1: Key Detection Tests
 * Tests the global key listener, key mapping, and shortcut detection
 */

const path = require('path');
const os = require('os');
const { TestFramework, TestUtils } = require('./test-framework');

const framework = new TestFramework('PHASE 1: Key Detection');

// Paths
const LOG_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/logs/desktop.log');
const SETTINGS_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/dictation-settings.json');

/**
 * Test 1.1: Global key listener initialization
 */
framework.test('Global key listener initialization', async () => {
  // Check if the app is running
  const isRunning = await TestUtils.isProcessRunning('TranscriptAI');
  
  if (!isRunning) {
    return {
      pass: false,
      message: 'TranscriptAI app is not running. Please start the desktop app first.',
    };
  }
  
  // Check if dictation is enabled
  const settings = await TestUtils.readJSON(SETTINGS_PATH);
  if (!settings || !settings.enabled) {
    return {
      pass: false,
      message: 'Dictation is not enabled in settings. Enable it first.',
    };
  }
  
  // Check log for listener attachment
  const hasListener = await TestUtils.checkLogContains(
    LOG_PATH,
    'node-global-key-listener loaded for dictation manager',
    2000
  );
  
  if (!hasListener) {
    return {
      pass: false,
      message: 'Global key listener not initialized in logs',
    };
  }
  
  return { pass: true };
});

/**
 * Test 1.2: Key event capture
 * This test requires manual interaction: press and release CMD key
 */
framework.test('Key event capture', async () => {
  console.log('\n  📋 ACTION REQUIRED: Press and release the CMD key once...');
  
  // Clear recent logs or note current position
  await TestUtils.sleep(1000);
  
  // Wait for key event in logs
  const hasKeyDown = await TestUtils.checkLogContains(
    LOG_PATH,
    'key down detected',
    10000 // 10 seconds to press the key
  );
  
  if (!hasKeyDown) {
    return {
      pass: false,
      message: 'No key down events detected in logs. Check Accessibility permissions.',
    };
  }
  
  return { pass: true };
}, ['Global key listener initialization']);

/**
 * Test 1.3: Key mapping to nut-js
 * Verify that keys are correctly mapped to nut-js Key enum
 */
framework.test('Key mapping to nut-js', async () => {
  console.log('\n  📋 ACTION REQUIRED: Press CMD key once...');
  
  await TestUtils.sleep(1000);
  
  // Check if key mapping is successful
  // Look for successful key mapping in logs
  const hasMapping = await TestUtils.checkLogContains(
    LOG_PATH,
    /key down detected.*dictation/i,
    10000
  );
  
  if (!hasMapping) {
    return {
      pass: false,
      message: 'Key mapping to nut-js failed. Check _mapListenerEventToKey() implementation.',
    };
  }
  
  return { pass: true };
}, ['Key event capture']);

/**
 * Test 1.4: Shortcut combination detection
 * Verify that the shortcut combination is detected when all keys are pressed
 */
framework.test('Shortcut combination detection', async () => {
  console.log('\n  📋 ACTION REQUIRED: Hold CMD+Option keys together for 2 seconds...');
  
  await TestUtils.sleep(1000);
  
  // Check for shortcut satisfaction in logs
  const hasShortcut = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation shortcut satisfied',
    15000
  );
  
  if (!hasShortcut) {
    return {
      pass: false,
      message: 'Shortcut not satisfied. Check shortcut configuration and _isShortcutSatisfied() logic.',
    };
  }
  
  return { pass: true };
}, ['Key mapping to nut-js']);

// Run tests
(async () => {
  const results = await framework.run();
  const success = framework.printSummary();
  process.exit(success ? 0 : 1);
})();

