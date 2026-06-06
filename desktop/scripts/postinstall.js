#!/usr/bin/env node
'use strict'

// Cross-platform postinstall.
// The macOS branding steps (rename Electron.app -> TranscriptAI.app, swap icon,
// patch Info.plist) only apply on macOS. On Windows/Linux this is a no-op so that
// `npm install` succeeds without Unix-only tools (mv/printf/cp/plutil).

const { execSync } = require('child_process')

if (process.platform !== 'darwin') {
  // Nothing to brand on non-macOS platforms.
  process.exit(0)
}

const steps = [
  "mv node_modules/electron/dist/Electron.app node_modules/electron/dist/TranscriptAI.app 2>/dev/null || true",
  "printf 'TranscriptAI.app/Contents/MacOS/Electron' > node_modules/electron/path.txt",
  "cp build/icon.icns node_modules/electron/dist/TranscriptAI.app/Contents/Resources/electron.icns 2>/dev/null || true",
  "plutil -replace CFBundleName -string 'TranscriptAI' node_modules/electron/dist/TranscriptAI.app/Contents/Info.plist 2>/dev/null || true",
  "plutil -replace CFBundleDisplayName -string 'TranscriptAI' node_modules/electron/dist/TranscriptAI.app/Contents/Info.plist 2>/dev/null || true",
]

try {
  execSync(steps.join(' && '), { stdio: 'inherit', shell: '/bin/bash' })
} catch (error) {
  // Branding is best-effort; never fail the install over it.
  console.warn('[postinstall] macOS branding step failed (non-fatal):', error.message)
}
