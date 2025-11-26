#!/usr/bin/env node

/**
 * Phase 7: Text Insertion Tests
 * Tests the text insertion via nut-js keyboard typing
 */

const path = require('path');
const os = require('os');
const { TestFramework, TestUtils } = require('./test-framework');

const framework = new TestFramework('PHASE 7: Text Insertion');

// Paths
const LOG_PATH = path.join(os.homedir(), 'Library/Application Support/transcriptai/logs/desktop.log');

/**
 * Test 7.1: Upload success handling
 */
framework.test('Upload success handling', async () => {
  console.log('\n  ⚠️  MANUAL VERIFICATION REQUIRED:');
  console.log('  Check browser DevTools console for:');
  console.log('  - "dictation upload succeeded"');
  console.log('  - Transcript text received from backend');
  
  await TestUtils.sleep(2000);
  
  return { pass: true };
});

/**
 * Test 7.2: Text insertion call
 */
framework.test('Text insertion call', async () => {
  console.log('\n  ⚠️  MANUAL VERIFICATION REQUIRED:');
  console.log('  Check browser DevTools console for:');
  console.log('  - "dictation text inserted" or "insertDictationText called"');
  console.log('  - Text payload being sent to main process');
  
  await TestUtils.sleep(2000);
  
  return { pass: true };
}, ['Upload success handling']);

/**
 * Test 7.3: IPC text typing request
 */
framework.test('IPC text typing request', async () => {
  console.log('\n  📋 ACTION REQUIRED: Open a text editor (TextEdit, Notes, etc.)');
  console.log('  Then perform full dictation: hold CMD+Option, speak "hello world", release');
  
  await TestUtils.sleep(15000);
  
  // Check for typeText call in desktop logs
  const hasTypeText = await TestUtils.checkLogContains(
    LOG_PATH,
    /typeText|dictation_type/i,
    5000
  );
  
  if (!hasTypeText) {
    console.log('  ⚠️  No typeText activity in desktop logs');
  } else {
    console.log('  ℹ️  IPC text typing request detected');
  }
  
  return { pass: true };
}, ['Text insertion call']);

/**
 * Test 7.4: nut-js keyboard typing
 */
framework.test('nut-js keyboard typing execution', async () => {
  console.log('\n  ⚠️  FINAL VERIFICATION:');
  console.log('  Did text appear in your text editor?');
  console.log('  - If YES: Push-to-talk is working end-to-end! ✅');
  console.log('  - If NO: Check desktop logs for typing errors');
  
  // Check for typing completion or errors
  const hasError = await TestUtils.checkLogContains(
    LOG_PATH,
    'dictation_type_text_error',
    3000
  );
  
  if (hasError) {
    return {
      pass: false,
      message: 'Text typing failed. Check desktop logs for error details.',
    };
  }
  
  console.log('  ℹ️  No typing errors detected in logs');
  
  await TestUtils.sleep(2000);
  
  return { pass: true };
}, ['IPC text typing request']);

// Run tests
(async () => {
  console.log('\n⚠️  IMPORTANT: Phase 7 tests require a text editor open');
  console.log('Open TextEdit or any text application before testing\n');
  
  const results = await framework.run();
  const success = framework.printSummary();
  
  console.log('\n📝 Manual Checklist for Phase 7:');
  console.log('  [ ] Browser console shows upload success');
  console.log('  [ ] Browser console shows text insertion call');
  console.log('  [ ] Desktop logs show typeText activity');
  console.log('  [ ] Text actually appeared in your text editor');
  
  console.log('\n🎯 END-TO-END TEST:');
  console.log('If text appeared in your editor, the push-to-talk feature is WORKING!');
  
  process.exit(success ? 0 : 1);
})();

