'use strict'

const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const { isValidProviderId } = require('./byok-providers')

const FILE_NAME = 'byok-keys.json'

let cachedFile = null
let cachedFilePath = null

function log(message, meta) {
  if (meta) {
    console.log(`[ByokStore] ${message}`, meta)
  } else {
    console.log(`[ByokStore] ${message}`)
  }
}

function getKeysFilePath() {
  if (!cachedFilePath) {
    cachedFilePath = path.join(app.getPath('userData'), FILE_NAME)
  }
  return cachedFilePath
}

function isEncryptionAvailable() {
  try {
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
      ? safeStorage.isEncryptionAvailable()
      : false
  } catch (_) {
    return false
  }
}

function readFromDisk() {
  try {
    const raw = fs.readFileSync(getKeysFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    log('keys file present but not an object — ignoring')
    return {}
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('failed to read keys file', { error: error.message })
    }
    return {}
  }
}

function loadCache({ forceRefresh = false } = {}) {
  if (cachedFile && !forceRefresh) return cachedFile
  cachedFile = readFromDisk()
  return cachedFile
}

function persist(state) {
  const filePath = getKeysFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  cachedFile = state
}

/**
 * Returns a map of providerId → boolean (whether a key is stored). Plaintext is never returned.
 */
function listStoredProviders() {
  const state = loadCache()
  const result = {}
  for (const id of Object.keys(state)) {
    if (isValidProviderId(id) && typeof state[id] === 'string' && state[id].length > 0) {
      result[id] = true
    }
  }
  return result
}

/**
 * Returns the decrypted plaintext key for the given provider, or null if not set / unavailable / corrupt.
 * Intended for main-process consumers (e.g. llm-router) only — never expose return value to renderer.
 */
function getKey(id) {
  if (!isValidProviderId(id)) return null
  if (!isEncryptionAvailable()) return null
  const state = loadCache()
  const encoded = state[id]
  if (typeof encoded !== 'string' || encoded.length === 0) return null
  try {
    const buffer = Buffer.from(encoded, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    log('failed to decrypt key', { id, error: error.message })
    return null
  }
}

function hasKey(id) {
  if (!isValidProviderId(id)) return false
  const state = loadCache()
  return typeof state[id] === 'string' && state[id].length > 0
}

/**
 * Stores an encrypted key for the given provider. Returns { ok, error? }.
 */
function setKey(id, plaintext) {
  if (!isValidProviderId(id)) {
    return { ok: false, error: 'unknown_provider' }
  }
  if (typeof plaintext !== 'string') {
    return { ok: false, error: 'invalid_key' }
  }
  const trimmed = plaintext.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'empty_key' }
  }
  if (!isEncryptionAvailable()) {
    return { ok: false, error: 'encryption_unavailable' }
  }

  let encryptedBuffer
  try {
    encryptedBuffer = safeStorage.encryptString(trimmed)
  } catch (error) {
    log('encryption failed', { id, error: error.message })
    return { ok: false, error: 'encryption_failed' }
  }

  try {
    const state = { ...loadCache() }
    state[id] = encryptedBuffer.toString('base64')
    persist(state)
    log('key saved', { id })
    return { ok: true }
  } catch (error) {
    log('failed to persist keys file', { id, error: error.message })
    return { ok: false, error: 'write_failed' }
  }
}

function deleteKey(id) {
  if (!isValidProviderId(id)) {
    return { ok: false, error: 'unknown_provider' }
  }
  try {
    const state = { ...loadCache() }
    if (id in state) {
      delete state[id]
      persist(state)
      log('key removed', { id })
    }
    return { ok: true }
  } catch (error) {
    log('failed to remove key', { id, error: error.message })
    return { ok: false, error: 'write_failed' }
  }
}

function _resetForTests() {
  cachedFile = null
  cachedFilePath = null
}

module.exports = {
  getKeysFilePath,
  isEncryptionAvailable,
  listStoredProviders,
  hasKey,
  getKey,
  setKey,
  deleteKey,
  _resetForTests,
}
