'use strict'

const Module = require('node:module')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ---------- electron stub ----------
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byok-store-test-'))
let encryptionAvailable = true

const safeStorageStub = {
  isEncryptionAvailable() {
    return encryptionAvailable
  },
  encryptString(plaintext) {
    // Trivial reversible "encryption" for tests: prefix marker + reversed bytes.
    return Buffer.from('ENC:' + plaintext, 'utf8')
  },
  decryptString(buffer) {
    const s = buffer.toString('utf8')
    if (!s.startsWith('ENC:')) throw new Error('bad ciphertext')
    return s.slice(4)
  },
}

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return request
  return originalResolve.call(this, request, ...args)
}
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: {
      getPath() {
        return tempDir
      },
    },
    safeStorage: safeStorageStub,
  },
}

const byokStore = require('../src/main/byok-store')

function resetState() {
  byokStore._resetForTests()
  encryptionAvailable = true
  const file = byokStore.getKeysFilePath()
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

test('setKey + getKey round-trip', () => {
  resetState()
  const result = byokStore.setKey('anthropic', 'sk-ant-test-123')
  assert.equal(result.ok, true)
  assert.equal(byokStore.hasKey('anthropic'), true)
  assert.equal(byokStore.getKey('anthropic'), 'sk-ant-test-123')
})

test('setKey rejects unknown provider', () => {
  resetState()
  const result = byokStore.setKey('not-a-provider', 'whatever')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unknown_provider')
})

test('setKey rejects non-string key', () => {
  resetState()
  const result = byokStore.setKey('openai', 12345)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid_key')
})

test('setKey rejects empty / whitespace-only key', () => {
  resetState()
  const r1 = byokStore.setKey('openai', '')
  assert.equal(r1.error, 'empty_key')
  const r2 = byokStore.setKey('openai', '   \t\n  ')
  assert.equal(r2.error, 'empty_key')
})

test('setKey trims surrounding whitespace before storing', () => {
  resetState()
  byokStore.setKey('openai', '   sk-test   ')
  assert.equal(byokStore.getKey('openai'), 'sk-test')
})

test('setKey refuses when encryption is unavailable', () => {
  resetState()
  encryptionAvailable = false
  const result = byokStore.setKey('anthropic', 'sk-ant-test')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'encryption_unavailable')
})

test('getKey returns null when encryption is unavailable, even if file exists', () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-ant-test')
  encryptionAvailable = false
  byokStore._resetForTests() // bust cache so we re-read disk
  assert.equal(byokStore.getKey('anthropic'), null)
})

test('listStoredProviders reflects what is on disk, not plaintext', () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-ant-test')
  byokStore.setKey('openai', 'sk-openai-test')
  const providers = byokStore.listStoredProviders()
  assert.deepEqual(providers, { anthropic: true, openai: true })
})

test('deleteKey removes the entry from disk and cache', () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-ant-test')
  byokStore.setKey('openai', 'sk-openai-test')
  const result = byokStore.deleteKey('anthropic')
  assert.equal(result.ok, true)
  assert.equal(byokStore.hasKey('anthropic'), false)
  assert.equal(byokStore.hasKey('openai'), true)
  // Verify on disk too
  const onDisk = JSON.parse(fs.readFileSync(byokStore.getKeysFilePath(), 'utf8'))
  assert.equal('anthropic' in onDisk, false)
  assert.equal('openai' in onDisk, true)
})

test('deleteKey is a no-op for unset providers', () => {
  resetState()
  const result = byokStore.deleteKey('xai')
  assert.equal(result.ok, true)
})

test('listStoredProviders returns empty map when file is missing', () => {
  resetState()
  assert.deepEqual(byokStore.listStoredProviders(), {})
})

test('corrupt JSON file is treated as empty', () => {
  resetState()
  fs.writeFileSync(byokStore.getKeysFilePath(), 'not valid json {{{', 'utf8')
  byokStore._resetForTests()
  assert.deepEqual(byokStore.listStoredProviders(), {})
})

test('non-object JSON file is treated as empty', () => {
  resetState()
  fs.writeFileSync(byokStore.getKeysFilePath(), '[]', 'utf8')
  byokStore._resetForTests()
  assert.deepEqual(byokStore.listStoredProviders(), {})
})

test('encrypted bytes are NOT plaintext on disk', () => {
  resetState()
  const plaintext = 'sk-ant-secret-do-not-leak'
  byokStore.setKey('anthropic', plaintext)
  const onDiskRaw = fs.readFileSync(byokStore.getKeysFilePath(), 'utf8')
  assert.equal(onDiskRaw.includes(plaintext), false)
})

test.after(() => {
  // Cleanup temp dir
  fs.rmSync(tempDir, { recursive: true, force: true })
})
