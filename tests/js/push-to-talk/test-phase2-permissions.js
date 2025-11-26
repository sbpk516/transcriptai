#!/usr/bin/env node

/**
 * Phase 2: Permission Flow Tests
 * Tests the permission request, checks, and auto-grant flow
 */

const path = require('path');
const os = require('os');
const { TestFramework, TestUtils } = require('./test-framework');

const framework = new TestFramework('PHASE 2: Permission Flow');

// Paths
const LOG_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/logs/desktop.log');

/**
 * Test 2.1: Permission request emission
 */
framework.test('Permission request emission', async () => {
  console.log('\n  📋 ACTION REQUIRED: Hold CMD+Option keys for 2 seconds then release...');
  
  await TestUtils.sleep(1000);
  
  // Check for permission request in logs
  const hasRequest = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_permission_request',
    15000
  );
  
  if (!hasRequest) {
    return {
      pass: false,
      message: 'Permission request not emitted. Check dictation:request-start event emission.',
    };
  }
  
  return { pass: true };
});

/**
 * Test 2.2: macOS Accessibility check
 */
framework.test('macOS Accessibility check', async () => {
  // Check for accessibility status in logs
  const hasAccessibility = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_accessibility',
    5000
  );
  
  if (!hasAccessibility) {
    return {
      pass: false,
      message: 'Accessibility check not found in logs.',
    };
  }
  
  // Check if accessibility permission is granted
  const fs = require('fs').promises;
  const logContent = await fs.readFile(LOG_PATH, 'utf8');
  const lastLines = logContent.split('\n').slice(-100).join('\n');
  
  if (lastLines.includes('"accessibility":false') || lastLines.includes('"accessibilityOk":false')) {
    return {
      pass: false,
      message: 'Accessibility permission not granted. Go to System Preferences → Security & Privacy → Privacy → Accessibility and enable TranscriptAI.',
    };
  }
  
  return { pass: true };
}, ['Permission request emission']);

/**
 * Test 2.3: macOS Microphone check
 */
framework.test('macOS Microphone check', async () => {
  // Check for microphone status in logs
  const hasMicrophone = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_microphone',
    5000
  );
  
  if (!hasMicrophone) {
    return {
      pass: false,
      message: 'Microphone check not found in logs.',
    };
  }
  
  // Check if microphone permission is granted
  const fs = require('fs').promises;
  const logContent = await fs.readFile(LOG_PATH, 'utf8');
  const lastLines = logContent.split('\n').slice(-100).join('\n');
  
  if (lastLines.includes('"microphone":false') || lastLines.includes('"micOk":false')) {
    return {
      pass: false,
      message: 'Microphone permission not granted. Go to System Preferences → Security & Privacy → Privacy → Microphone and enable TranscriptAI.',
    };
  }
  
  return { pass: true };
}, ['Permission request emission']);

/**
 * Test 2.4: Auto-grant permission flow
 */
framework.test('Auto-grant permission flow', async () => {
  // Check for auto-grant in logs
  const hasAutoGrant = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_permission_autogranted',
    5000
  );
  
  if (!hasAutoGrant) {
    return {
      pass: false,
      message: 'Auto-grant not triggered. Check grantPermission() logic and requestId flow.',
    };
  }
  
  return { pass: true };
}, ['macOS Accessibility check', 'macOS Microphone check']);

// Run tests
(async () => {
  const results = await framework.run();
  const success = framework.printSummary();
  process.exit(success ? 0 : 1);
})();

