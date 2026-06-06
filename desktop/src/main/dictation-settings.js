const { app } = require('electron')
const fs = require('fs')
const path = require('path')

// Default push-to-talk chord. "Option" is the macOS modifier; its Windows/Linux
// equivalent is "Alt". CommandOrControl already maps to Cmd on macOS and Ctrl elsewhere.
const DEFAULT_SHORTCUT = process.platform === 'darwin'
  ? 'CommandOrControl+Option'
  : 'CommandOrControl+Alt'

const DEFAULT_SETTINGS = {
  enabled: false,
  shortcut: DEFAULT_SHORTCUT,
}

let cachedSettings = null
let settingsPath = null

function log(message, meta) {
  if (meta) {
    console.log(`[DictationSettings] ${message}`, meta)
  } else {
    console.log(`[DictationSettings] ${message}`)
  }
}

function getSettingsPath() {
  if (!settingsPath) {
    const userDir = app.getPath('userData')
    settingsPath = path.join(userDir, 'dictation-settings.json')
  }
  return settingsPath
}

function readSettingsFromDisk() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('Failed to read settings file', { error: error.message })
    }
  }
  return {}
}

function normalizeShortcut(shortcut) {
  if (typeof shortcut !== 'string') {
    return DEFAULT_SETTINGS.shortcut
  }
  const trimmed = shortcut.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.shortcut
}

function normalizePartial(partial) {
  const normalized = {}
  if (partial && typeof partial === 'object') {
    if (typeof partial.enabled === 'boolean') {
      normalized.enabled = partial.enabled
    }
    if (partial.shortcut !== undefined) {
      normalized.shortcut = normalizeShortcut(partial.shortcut)
    }
  }
  return normalized
}

function loadSettings({ forceRefresh = false } = {}) {
  if (cachedSettings && !forceRefresh) {
    return cachedSettings
  }
  const diskSettings = readSettingsFromDisk()
  cachedSettings = { ...DEFAULT_SETTINGS, ...normalizePartial(diskSettings) }
  return cachedSettings
}

function saveSettings(update) {
  const current = loadSettings()
  const normalizedUpdate = normalizePartial(update)
  const merged = { ...current, ...normalizedUpdate }

  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf8')
    cachedSettings = merged
    log('Settings saved', merged)
    return merged
  } catch (error) {
    log('Failed to write settings file', { error: error.message })
    throw error
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettingsPath,
  loadSettings,
  saveSettings,
  normalizePartial,
}
