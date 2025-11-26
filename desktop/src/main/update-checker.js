const { app, BrowserWindow } = require('electron')
const https = require('node:https')
const { URL } = require('node:url')
const semver = require('semver')

const MANIFEST_URL = 'https://github.com/sbpk516/transcriptai/releases/latest/download/latest.json'
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 15000

function log(message, meta) {
  if (meta) {
    console.log(`[Updater] ${message}`, meta)
  } else {
    console.log(`[Updater] ${message}`)
  }
}

let latestAvailableManifest = null

function fetchManifest(url = MANIFEST_URL, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    log('Checking for updates...', { url })
    const requestUrl = new URL(url)
    const req = https.get(requestUrl, res => {
      const { statusCode, headers } = res

      if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume()
        if (redirectCount >= MAX_REDIRECTS) {
          return reject(new Error('Too many redirects while fetching manifest'))
        }
        const nextUrl = new URL(headers.location, requestUrl)
        return resolve(fetchManifest(nextUrl.toString(), redirectCount + 1))
      }

      if (!statusCode || statusCode < 200 || statusCode >= 300) {
        res.resume()
        return reject(new Error(`Unexpected response: HTTP ${statusCode || 'unknown'}`))
      }

      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        body += chunk
      })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          resolve(json)
        } catch (err) {
          reject(new Error(`Failed to parse manifest JSON: ${err.message}`))
        }
      })
    })

    req.on('error', err => {
      reject(err)
    })

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Update manifest request timed out'))
    })
  })
}

function normalizeVersion(version) {
  if (!version) return null
  const cleaned = semver.valid(version)
  if (cleaned) return cleaned
  const coerced = semver.coerce(version)
  return coerced ? coerced.version : null
}

function isNewerVersion(current, latest) {
  const normalizedCurrent = normalizeVersion(current)
  const normalizedLatest = normalizeVersion(latest)
  if (!normalizedLatest) {
    log('Latest version string from manifest is invalid, skipping.', { latest })
    return false
  }
  if (!normalizedCurrent) {
    log('Current app version string is invalid, treating manifest as newer.', { currentVersion: current })
    return true
  }
  return semver.gt(normalizedLatest, normalizedCurrent)
}

async function checkForUpdates() {
  const currentVersion = app.getVersion()
  try {
    const manifest = await fetchManifest()
    if (!manifest || !manifest.latestVersion) {
      log('Manifest missing latestVersion field, skipping.', manifest)
      return null
    }

    if (isNewerVersion(currentVersion, manifest.latestVersion)) {
      log(`Update found: v${manifest.latestVersion}`, { currentVersion })
      latestAvailableManifest = manifest
      const windows = BrowserWindow.getAllWindows()
      windows.forEach(win => {
        try {
          win.webContents.send('update-available', manifest)
        } catch (err) {
          log('Failed to send update manifest to renderer', { error: err.message })
        }
      })
      return manifest
    }

    log('No new update available.', { currentVersion, latestVersion: manifest.latestVersion })
    return manifest
  } catch (error) {
    log('Update check failed', { error: error.message })
    return null
  }
}

module.exports = {
  MANIFEST_URL,
  CHECK_INTERVAL_MS,
  checkForUpdates,
  getLatestManifest: () => latestAvailableManifest,
}
