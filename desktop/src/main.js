const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')

// --- Child Process Manager (Zombie Killer) ---
class ChildProcessManager {
  constructor() {
    this.processes = []
  }

  spawn(command, args, name, options = {}) {
    logLine('spawning_process', { name, command, args })
    const p = spawn(command, args, options)

    // Store reference
    this.processes.push({ name, process: p, command })

    // Logging hooks
    if (p.stdout) p.stdout.on('data', d => logLine(name, 'stdout', d.toString().trim()))
    if (p.stderr) p.stderr.on('data', d => logLine(name, 'stderr', d.toString().trim()))

    p.on('exit', (code, signal) => {
      logLine(name, 'exited', { code, signal })
      // Remove from list if dead
      this.processes = this.processes.filter(proc => proc.process !== p)
    })

    return p
  }

  killAll() {
    logLine('killing_all_processes', this.processes.length)
    this.processes.forEach(({ process, name }) => {
      try {
        logLine('killing', name)
        process.kill('SIGTERM')
        // Force kill backup
        setTimeout(() => {
          if (!process.killed) process.kill('SIGKILL')
        }, 1000)
      } catch (e) {
        logLine('kill_error', name, e.message)
      }
    })
    this.processes = []
  }
}

const processManager = new ChildProcessManager()
app.on('before-quit', () => processManager.killAll())

const dictationSettings = require('./main/dictation-settings')
const DictationManager = require('./main/dictation-manager')
const recordingIndicatorWindow = require('./main/recording-indicator-window')
let macPermissions = null
try {
  macPermissions = require('node-mac-permissions')
} catch (error) {
  macPermissions = null
}

// Ensure ffmpeg/ffprobe are visible when spawned from app (Homebrew paths)
const HOMEBREW_BIN = '/opt/homebrew/bin'
const USR_LOCAL_BIN = '/usr/local/bin'
const withBrewPath = (p) => [HOMEBREW_BIN, USR_LOCAL_BIN, p || ''].filter(Boolean).join(':')

// Helper: Find free port
function getFreePort() {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

// Read frontend port from root config.js (best-effort)
function getFrontendPort() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require('../../config.js')
    if (cfg && cfg.FRONTEND_PORT) return cfg.FRONTEND_PORT
  } catch (_) { }
  return 3000
}

const isDev = !app.isPackaged
const FRONTEND_PORT = getFrontendPort()
const CHECK_INTERVAL_MS = 1000 * 60 * 15 // 15 minutes

// Simple logger to file under userData
function logLine(...args) {
  console.log(...args); // Print to terminal
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    fs.appendFileSync(path.join(dir, 'desktop.log'), line)
  } catch (_) { }
}

let backendInfo = { port: 8001, pid: null, mode: isDev ? 'dev' : 'prod' }
let backendProcess = null
let whisperServerProcess = null
let WHISPER_PORT = 0; // Will be assigned dynamically
let lastLoadTarget = ''
let updateInterval = null
let dictationSettingsReady = false
let dictationManager = null

/**
 * Stub for auto-update check.
 * TODO: Implement actual update checking via electron-updater if needed.
 */
async function checkForUpdates() {
  if (isDev) {
    logLine('update_check_skip', 'Skipping update check in dev mode')
    return
  }
  logLine('update_check', 'Auto-update not configured (stub)')
}

async function triggerDictationWarmup(port) {
  return new Promise(resolve => {
    try {
      const req = http.request({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/api/v1/dictation/warmup',
        timeout: 15000,
      }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          logLine('dictation_warmup_response', { statusCode: res.statusCode, body })
          resolve()
        })
      })
      req.on('error', err => {
        logLine('dictation_warmup_error', err.message)
        resolve()
      })
      req.end()
    } catch (error) {
      logLine('dictation_warmup_exception', error.message)
      resolve()
    }
  })
}

async function syncDictationManager(settings) {
  try {
    const manager = getDictationManager()
    if (settings && typeof settings.shortcut === 'string') {
      await manager.updateShortcut({ shortcut: settings.shortcut })
    }
    if (settings && settings.enabled) {
      const started = await manager.startListening(settings)
      if (started) {
        logLine('dictation_manager_started', settings)
      } else {
        logLine('dictation_manager_start_failed', { platform: process.platform })
        broadcastDictationLifecycle('dictation:listener-fallback', {
          reason: 'listener_failed',
          platform: process.platform,
        })
      }
    } else {
      await manager.stopListening()
      logLine('dictation_manager_stopped')
    }
  } catch (error) {
    logLine('dictation_manager_sync_error', error.message)
  }
}

async function checkMacAccessibility() {
  if (process.platform !== 'darwin' || !macPermissions) {
    return true
  }
  try {
    const trusted = macPermissions.isTrustedAccessibilityClient?.(false)
    logLine('dictation_accessibility_status', { trusted })
    return !!trusted
  } catch (error) {
    logLine('dictation_accessibility_check_error', error.message)
    return false
  }
}

async function checkMacMicPermission() {
  if (process.platform !== 'darwin' || !macPermissions) {
    return true
  }
  try {
    const status = macPermissions.getMicrophoneAuthorizationStatus?.()
    logLine('dictation_microphone_status', { status })
    return status === 'authorized' || status === 'not determined'
  } catch (error) {
    logLine('dictation_microphone_check_error', error.message)
    return false
  }
}

async function promptMacPermissions() {
  if (process.platform !== 'darwin' || !macPermissions) {
    return { accessibility: true, microphone: true }
  }
  let accessibility = false
  let microphone = false
  try {
    accessibility = macPermissions.isTrustedAccessibilityClient?.(true) ?? false
    logLine('dictation_accessibility_prompt', { accessibility })
  } catch (error) {
    logLine('dictation_accessibility_prompt_error', error.message)
  }
  try {
    microphone = macPermissions.askForMicrophoneAccess?.() ?? false
    logLine('dictation_microphone_prompt', { microphone })
  } catch (error) {
    logLine('dictation_microphone_prompt_error', error.message)
  }
  return { accessibility, microphone }
}

async function isPortFree(port) {
  return new Promise(resolve => {
    const tester = net.createServer()
    tester.once('error', (err) => {
      // Port is in use or error binding
      logLine('port_check_failed', { port, error: err.message })
      resolve(false)
    })
    tester.once('listening', () => {
      tester.close(() => {
        logLine('port_check_ok', { port })
        resolve(true)
      })
    })
    tester.listen(port, '127.0.0.1')
  })
}

async function findPort(candidates = [8001, 8011, 8021]) {
  logLine('find_port_start', { candidates })
  for (const p of candidates) {
    // Check if port is truly free (not just available to bind, but actually listening)
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) {
      // Double-check by trying to connect to the port
      const isActuallyFree = await new Promise(resolve => {
        const testSocket = net.createConnection({ port: p, host: '127.0.0.1' }, () => {
          // Connection succeeded - port is in use
          testSocket.destroy()
          resolve(false)
        })
        testSocket.on('error', () => {
          // Connection failed - port is free
          resolve(true)
        })
        // Timeout after 100ms
        setTimeout(() => {
          testSocket.destroy()
          resolve(true) // Assume free if connection times out
        }, 100)
      })

      if (isActuallyFree) {
        logLine('find_port_selected', { port: p })
        return p
      } else {
        logLine('find_port_busy', { port: p })
      }
    }
  }
  // Fallback to ephemeral
  logLine('find_port_ephemeral')
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => {
        logLine('find_port_ephemeral_selected', { port })
        resolve(port)
      })
    })
  })
}

function waitForHealth(port, { attempts = (isDev ? 20 : 60), delayMs = 500, candidatePorts = null } = {}) {
  // If candidatePorts provided, try each one (handles Python fallback to different port)
  const portsToTry = candidatePorts || [port]
  let attempt = 0
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      attempt += 1
      let pending = portsToTry.length
      let foundPort = null

      for (const p of portsToTry) {
        const url = `http://127.0.0.1:${p}/health`
        const req = http.get(url, res => {
          if (foundPort) { res.resume(); return }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            foundPort = p
            const elapsed = Date.now() - startedAt
            logLine('health_ok', url, `attempt=${attempt}`, `elapsed_ms=${elapsed}`)
            resolve({ ok: true, port: p })
          } else {
            res.resume()
            pending--
            if (pending === 0 && !foundPort) {
              if (attempt >= attempts) return reject(new Error('health_failed'))
              setTimeout(tick, delayMs)
            }
          }
        })
        req.on('error', () => {
          if (foundPort) return
          pending--
          if (pending === 0 && !foundPort) {
            if (attempt >= attempts) return reject(new Error('health_failed'))
            setTimeout(tick, delayMs)
          }
        })
      }
    }
    tick()
  })
}

function dataDir() {
  // Ensure a stable data dir for DB/uploads/logs
  return app.getPath('userData')
}

async function startBackendDev() {
  const port = await findPort()
  backendInfo.port = port

  // Allocate Whisper Port
  WHISPER_PORT = await getFreePort()
  const LLAMA_PORT = await getFreePort()
  logLine('allocated_ports', { whisper: WHISPER_PORT, llama: LLAMA_PORT })

  // Spawn Whisper Server (C++)
  const whisperBinary = path.join(__dirname, '../../backend-cpp/whisper-server')
  const whisperModel = path.join(__dirname, '../../backend-cpp/models/ggml-base.en.bin')

  if (fs.existsSync(whisperBinary) && fs.existsSync(whisperModel)) {
    logLine('info', 'Spawning Whisper Server', { binary: whisperBinary, model: whisperModel, port: WHISPER_PORT })
    // Spawn server with model and port
    whisperServerProcess = processManager.spawn(whisperBinary, [
      '-m', whisperModel,
      '--port', String(WHISPER_PORT)
    ], 'whisper-server')
  } else {
    logLine('warn', 'Whisper binary or model missing', { binary: whisperBinary, model: whisperModel })
  }

  // --- Feature: Test Bundled Backend in Dev Mode ---
  if (process.env.FORCE_BUNDLED_BACKEND === '1') {
    // We define env here because it's needed for the bundle spawn
    const env = {
      ...process.env,
      PATH: withBrewPath(process.env.PATH),
      TRANSCRIPTAI_MODE: 'desktop',
      TRANSCRIPTAI_PORT: String(port),
      TRANSCRIPTAI_DATA_DIR: dataDir(),
      WHISPER_CPP_PORT: String(WHISPER_PORT),
      LLAMA_CPP_PORT: String(LLAMA_PORT),
      TRANSCRIPTAI_USE_MLX: '0',
      TRANSCRIPTAI_LIVE_MIC: '1',
      TRANSCRIPTAI_LIVE_TRANSCRIPTION: '1',
    }

    const bundlePath = path.join(__dirname, '../../backend/dist/transcriptai-backend', 'transcriptai-backend')
    if (fs.existsSync(bundlePath)) {
      logLine('spawn_backend_dev', 'FORCE_BUNDLED_BACKEND=1', bundlePath)
      backendProcess = processManager.spawn(bundlePath, [], 'bundled-backend', {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      backendInfo.pid = backendProcess.pid

      let waitStart = Date.now()
      try {
        const candidatePorts = [port, 8001, 8011, 8021, 8031, 8041]
        const healthResult = await waitForHealth(port, { candidatePorts })
        const actualPort = healthResult.port || port
        if (actualPort !== port) {
          logLine('backend_port_fallback', { expected: port, actual: actualPort })
          backendInfo.port = actualPort
        }
        logLine('backend_health_ready', { port: actualPort, elapsed_ms: Date.now() - waitStart })
        await triggerDictationWarmup(actualPort)
        return // Exit early since we spawned the bundle
      } catch (e) {
        logLine('backend_health_failed', e.message)
        throw e
      }
    } else {
      logLine('warn', 'FORCE_BUNDLED_BACKEND requested but binary not found', bundlePath)
    }
  }

  // If we didn't exit early, we are running python source
  const env = {
    ...process.env,
    PATH: withBrewPath(process.env.PATH),
    TRANSCRIPTAI_MODE: 'desktop',
    TRANSCRIPTAI_PORT: String(port),
    TRANSCRIPTAI_DATA_DIR: dataDir(),
    WHISPER_CPP_PORT: String(WHISPER_PORT),
    LLAMA_CPP_PORT: String(LLAMA_PORT),
    TRANSCRIPTAI_USE_MLX: process.env.TRANSCRIPTAI_USE_MLX || '0',
    TRANSCRIPTAI_LIVE_MIC: '1',
    TRANSCRIPTAI_LIVE_TRANSCRIPTION: '1',
  }

  const cwd = path.join(__dirname, '..', '..', 'backend')
  const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)]

  logLine('spawn_backend_dev', JSON.stringify({ cwd, args }))

  backendProcess = processManager.spawn(process.env.ELECTRON_PYTHON || 'python', args, 'python-backend', {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  backendInfo.pid = backendProcess.pid

  // Wait for Health
  let waitStart = Date.now()
  try {
    const candidatePorts = [port, 8001, 8011, 8021, 8031, 8041]
    const healthResult = await waitForHealth(port, { candidatePorts })
    const actualPort = healthResult.port || port
    if (actualPort !== port) {
      logLine('backend_port_fallback', { expected: port, actual: actualPort })
      backendInfo.port = actualPort
    }
    logLine('backend_health_ready', { port: actualPort, elapsed_ms: Date.now() - waitStart })
    await triggerDictationWarmup(actualPort)
  } catch (e) {
    logLine('backend_health_failed', e.message)
    throw e
  }
}

async function startBackendProd() {
  logLine('=== startBackendProd BEGIN ===')

  const port = await findPort()
  backendInfo.port = port
  logLine('STEP 1: Backend port assigned', { port })

  WHISPER_PORT = await getFreePort()
  logLine('STEP 2: Whisper port assigned', { WHISPER_PORT })

  const backendPath = path.join(process.resourcesPath, 'backend', 'transcriptai-backend', process.platform === 'win32' ? 'transcriptai-backend.exe' : 'transcriptai-backend')
  const whisperPath = path.join(process.resourcesPath, 'whisper-server')
  const whisperModelPath = path.join(process.resourcesPath, 'models', 'ggml-base.en.bin')

  logLine('STEP 3: Paths resolved', {
    resourcesPath: process.resourcesPath,
    backendPath,
    whisperPath,
    whisperModelPath
  })

  // Check if files exist
  const backendExists = fs.existsSync(backendPath)
  const whisperExists = fs.existsSync(whisperPath)
  const modelExists = fs.existsSync(whisperModelPath)
  logLine('STEP 4: File existence check', { backendExists, whisperExists, modelExists })

  // Launch whisper-server with model
  if (whisperExists && modelExists) {
    logLine('STEP 5: Starting whisper-server...')
    whisperServerProcess = processManager.spawn(whisperPath, [
      '-m', whisperModelPath,
      '--port', String(WHISPER_PORT)
    ], 'whisper-server')
    logLine('STEP 5: whisper-server spawned', { pid: whisperServerProcess.pid })

    // Wait for whisper-server to be ready (poll health endpoint)
    logLine('STEP 6: Waiting for whisper-server health...')
    const whisperReady = await waitForWhisperHealth(WHISPER_PORT, 30) // 30 second timeout
    logLine('STEP 6: whisper-server health result', { ready: whisperReady })
  } else {
    logLine('STEP 5: SKIPPED - whisper-server files missing', { whisperExists, modelExists })
  }

  const env = {
    ...process.env,
    PATH: withBrewPath(process.env.PATH),
    TRANSCRIPTAI_MODE: 'desktop',
    TRANSCRIPTAI_PORT: String(port),
    TRANSCRIPTAI_DATA_DIR: dataDir(),
    WHISPER_CPP_PORT: String(WHISPER_PORT),
    WHISPER_CPP_MODEL: whisperModelPath,
    TRANSCRIPTAI_USE_MLX: '0',
    TRANSCRIPTAI_LIVE_MIC: '1',
    TRANSCRIPTAI_LIVE_TRANSCRIPTION: '1',
  }

  logLine('STEP 7: Environment vars for Python backend', {
    TRANSCRIPTAI_MODE: env.TRANSCRIPTAI_MODE,
    TRANSCRIPTAI_PORT: env.TRANSCRIPTAI_PORT,
    TRANSCRIPTAI_DATA_DIR: env.TRANSCRIPTAI_DATA_DIR,
    WHISPER_CPP_PORT: env.WHISPER_CPP_PORT,
    WHISPER_CPP_MODEL: env.WHISPER_CPP_MODEL,
    TRANSCRIPTAI_USE_MLX: env.TRANSCRIPTAI_USE_MLX
  })

  logLine('STEP 8: Starting Python backend...', { backendPath })
  backendProcess = processManager.spawn(backendPath, [], 'python-backend', { env })
  backendInfo.pid = backendProcess.pid
  logLine('STEP 8: Python backend spawned', { pid: backendProcess.pid })

  logLine('STEP 9: Waiting for Python backend health...')
  let waitStart = Date.now()
  try {
    const candidatePorts = [port, 8001, 8011, 8021, 8031, 8041]
    const healthResult = await waitForHealth(port, { candidatePorts })
    const actualPort = healthResult.port || port
    if (actualPort !== port) {
      logLine('STEP 9: Python backend port fallback', { expected: port, actual: actualPort })
      backendInfo.port = actualPort
    }
    logLine('STEP 9: Python backend ready', { port: actualPort, elapsed_ms: Date.now() - waitStart })
  } catch (e) {
    logLine('STEP 9: Python backend health FAILED', { error: e.message, elapsed_ms: Date.now() - waitStart })
    throw e
  }

  logLine('=== startBackendProd END ===')
}

// Helper to wait for whisper-server health
async function waitForWhisperHealth(port, timeoutSec = 30) {
  const startTime = Date.now()
  const maxTime = timeoutSec * 1000

  while (Date.now() - startTime < maxTime) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 }, res => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => resolve({ status: res.statusCode, data }))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      })

      if (response.status === 200) {
        logLine('whisper_health_success', { port, elapsed_ms: Date.now() - startTime, response: response.data })
        return true
      }
    } catch (e) {
      // Not ready yet, keep polling
    }
    await new Promise(r => setTimeout(r, 500)) // Poll every 500ms
  }

  logLine('whisper_health_timeout', { port, elapsed_ms: Date.now() - startTime })
  return false
}

let mainWindow = null

async function createMainWindow() {
  // Start backend BEFORE creating the window so preload sees the correct port
  try {
    if (isDev) {
      await startBackendDev()
    } else {
      await startBackendProd()
    }
  } catch (e) {
    logLine('backend_start_error', e.message)
    // Continue; UI will show an error but preload will still expose backendInfo
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const devUrl = `http://localhost:${FRONTEND_PORT}`

  // If forcing bundled backend, we typically want to test the full bundled experience (static files)
  const forceBundle = process.env.FORCE_BUNDLED_BACKEND === '1'

  let prodIndex = path.join(process.resourcesPath, 'frontend_dist', 'index.html')
  if (isDev && forceBundle) {
    // In simulation mode, point to the actual local build folder
    prodIndex = path.join(__dirname, '../../frontend/dist/index.html')
  }

  const loadTarget = (isDev && !forceBundle) ? devUrl : `file://${prodIndex}`
  lastLoadTarget = loadTarget

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show())
  mainWindow.loadURL(loadTarget)

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function createAppMenu() {
  const openLogs = () => {
    try {
      const dir = path.join(app.getPath('userData'), 'logs')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      shell.openPath(dir)
    } catch (e) {
      logLine('open_logs_error', e.message)
    }
  }

  const openResources = () => {
    try {
      shell.openPath(process.resourcesPath)
    } catch (e) {
      logLine('open_resources_error', e.message)
    }
  }

  const showBackendInfo = () => {
    const msg = `Mode: ${backendInfo.mode}\nPort: ${backendInfo.port}\nPID: ${backendInfo.pid || 'n/a'}`
    dialog.showMessageBox({ type: 'info', title: 'Backend Info', message: 'Backend Information', detail: msg })
  }

  const showLoadTarget = () => {
    dialog.showMessageBox({ type: 'info', title: 'Load Target', message: 'Renderer Load Target', detail: lastLoadTarget || '(unknown)' })
  }

  const runHealthCheck = async () => {
    const url = `http://127.0.0.1:${backendInfo.port}/health`
    try {
      const status = await new Promise((resolve, reject) => {
        const req = http.get(url, res => {
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300
          res.resume()
          ok ? resolve('OK') : reject(new Error(`HTTP ${res.statusCode}`))
        })
        req.on('error', reject)
      })
      dialog.showMessageBox({ type: 'info', title: 'Health Check', message: `Backend health: ${status}`, detail: url })
    } catch (e) {
      dialog.showMessageBox({ type: 'error', title: 'Health Check', message: 'Backend health failed', detail: `${url}\n${e.message}` })
    }
  }

  const template = [
    {
      label: 'TranscriptAI',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Debug',
      submenu: [
        { label: 'Toggle DevTools', click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools() } },
        { type: 'separator' },
        { label: 'Show Backend Info', click: showBackendInfo },
        { label: 'Run Health Check', click: runHealthCheck },
        { label: 'Show Load Target', click: showLoadTarget },
        { type: 'separator' },
        { label: 'Open Logs Folder', click: openLogs },
        { label: 'Open Resources Folder', click: openResources }
      ]
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.on('ready', async () => {
  const launchStartTime = Date.now()
  const launchStartTimestamp = new Date().toISOString()
  logLine('[LAUNCH] phase=electron_ready timestamp=' + launchStartTimestamp)

  let dictationSettingsStartTime = Date.now()
  let initialDictationSettings = null
  try {
    initialDictationSettings = dictationSettings.loadSettings()
    dictationSettingsReady = true
    const dictationSettingsElapsed = Date.now() - dictationSettingsStartTime
    logLine('[LAUNCH] phase=dictation_settings_load elapsed=' + dictationSettingsElapsed + 'ms')
    logLine('dictation_settings_loaded', initialDictationSettings)
  } catch (error) {
    const dictationSettingsElapsed = Date.now() - dictationSettingsStartTime
    logLine('[LAUNCH] phase=dictation_settings_load elapsed=' + dictationSettingsElapsed + 'ms error=' + error.message)
    logLine('dictation_settings_load_error', error.message)
  }


  // Fire dictation sync in background (don't block startup)
  // This previously took 9-109 seconds - now runs in parallel
  const dictationSyncPromise = (async () => {
    const dictationManagerSyncStartTime = Date.now()
    try {
      if (initialDictationSettings) {
        await syncDictationManager(initialDictationSettings)
      } else {
        await syncDictationManager({ enabled: false })
      }
      const dictationManagerSyncElapsed = Date.now() - dictationManagerSyncStartTime
      logLine('[LAUNCH] phase=dictation_manager_sync elapsed=' + dictationManagerSyncElapsed + 'ms')
    } catch (err) {
      logLine('[LAUNCH] phase=dictation_manager_sync error=' + err.message)
    }
  })()

  const manager = getDictationManager()
  manager.on('dictation:press-start', payload => {
    logLine('dictation_event_start', payload)
    broadcastDictationLifecycle('dictation:press-start', payload)
  })
  manager.on('dictation:press-end', payload => {
    logLine('dictation_event_end', payload)
    broadcastDictationLifecycle('dictation:press-end', payload)
  })
  manager.on('dictation:press-cancel', payload => {
    logLine('dictation_event_cancel', payload)
    broadcastDictationLifecycle('dictation:press-cancel', payload)
  })
  manager.on('dictation:request-start', async (payload) => {
    logLine('dictation_permission_request', payload)
    const accessibilityOk = await checkMacAccessibility()
    const micOk = await checkMacMicPermission()
    broadcastDictationLifecycle('dictation:permission-requested', {
      ...payload,
      accessibilityOk,
      micOk,
    })
    const requestId = payload && typeof payload.requestId === 'number' ? payload.requestId : null
    if (!accessibilityOk || !micOk) {
      broadcastDictationLifecycle('dictation:permission-required', {
        ...payload,
        accessibilityOk,
        micOk,
      })
      return
    }
    if (requestId !== null) {
      const granted = manager.grantPermission({ requestId, source: 'auto-check' })
      if (!granted) {
        logLine('dictation_permission_autogrant_failed', { requestId })
      } else {
        logLine('dictation_permission_autogranted', { requestId })
      }
    } else {
      logLine('dictation_permission_autogrant_missing_request', payload)
    }
  })
  manager.on('dictation:permission-granted', payload => {
    logLine('dictation_permission_granted', payload)
    broadcastDictationLifecycle('dictation:permission-granted', payload)
  })
  manager.on('dictation:permission-denied', payload => {
    logLine('dictation_permission_denied', payload)
    broadcastDictationLifecycle('dictation:permission-denied', payload)
  })
  manager.on('dictation:permission-cleared', payload => {
    logLine('dictation_permission_cleared', payload)
    broadcastDictationLifecycle('dictation:permission-cleared', payload)
  })
  manager.on('dictation:permission-denied', payload => {
    if (payload.reason === 'listener_failed') {
      broadcastDictationLifecycle('dictation:listener-fallback', payload)
    }
  })
  manager.on('dictation:stuck-key', payload => {
    logLine('dictation_stuck_key_detected', payload)
    broadcastDictationLifecycle('dictation:stuck-key', payload)
  })
  createAppMenu()
  await createMainWindow()
  try {
    await checkForUpdates()
  } catch (e) {
    logLine('update_check_error', e.message)
  }
  updateInterval = setInterval(() => {
    checkForUpdates().catch(err => logLine('update_check_error', err.message))
  }, CHECK_INTERVAL_MS)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill()
    }
  } catch (_) { }
  try {
    if (dictationManager) {
      dictationManager.dispose().catch(err => logLine('dictation_manager_dispose_error', err.message))
    }
  } catch (error) {
    logLine('dictation_manager_dispose_error', error.message)
  }
  try {
    recordingIndicatorWindow.destroyWindow()
  } catch (error) {
    logLine('dictation_indicator_destroy_error', error.message)
  }
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
})

// IPC for renderer to get backend info
ipcMain.handle('get-backend-info', async () => backendInfo)
ipcMain.on('get-backend-info-sync', (event) => {
  event.returnValue = backendInfo
})

ipcMain.handle('dictation:get-settings', async () => {
  try {
    const settings = dictationSettings.loadSettings({ forceRefresh: !dictationSettingsReady })
    dictationSettingsReady = true
    logLine('dictation_settings_get', settings)
    return settings
  } catch (error) {
    logLine('dictation_settings_get_error', error.message)
    throw error
  }
})

ipcMain.handle('dictation:set-settings', async (_event, payload = {}) => {
  try {
    const updated = dictationSettings.saveSettings(payload)
    dictationSettingsReady = true
    logLine('dictation_settings_set', updated)
    await syncDictationManager(updated)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.webContents.send('dictation:settings-updated', updated)
      } catch (notifyError) {
        logLine('dictation_settings_notify_error', notifyError.message)
      }
    })
    return updated
  } catch (error) {
    logLine('dictation_settings_set_error', error.message)
    throw error
  }
})

ipcMain.handle('dictation:permission-response', async (_event, payload = {}) => {
  try {
    const { requestId, granted, reason } = payload || {}
    const manager = getDictationManager()
    if (requestId === undefined || requestId === null) {
      logLine('dictation_permission_response_missing_request', payload)
      return { ok: false, message: 'missing_request_id' }
    }
    if (typeof granted !== 'boolean') {
      logLine('dictation_permission_response_invalid_flag', payload)
      return { ok: false, message: 'invalid_granted_flag' }
    }
    if (granted) {
      const ok = manager.grantPermission({ requestId, source: 'renderer' })
      if (!ok) {
        logLine('dictation_permission_response_no_pending', { requestId, granted })
      }
      return ok ? { ok: true } : { ok: false, message: 'no_pending_request' }
    }
    const ok = manager.denyPermission({ requestId, reason: reason || 'renderer_denied' })
    if (!ok) {
      logLine('dictation_permission_response_no_pending', { requestId, granted })
    }
    return ok ? { ok: true } : { ok: false, message: 'no_pending_request' }
  } catch (error) {
    logLine('dictation_permission_response_error', error.message)
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('dictation:cancel-active-press', async (_event, payload = {}) => {
  try {
    const manager = getDictationManager()
    const { reason = 'renderer_cancelled', details = {} } = payload || {}
    const ok = manager.cancelActivePress({ reason, details })
    if (!ok) {
      logLine('dictation_cancel_noop', { reason, details })
      return { ok: false, message: 'no_active_press' }
    }
    logLine('dictation_cancel_request', { reason, details })
    return { ok: true }
  } catch (error) {
    logLine('dictation_cancel_error', error.message)
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('dictation:type-text', async (_event, payload = {}) => {
  try {
    const manager = getDictationManager()
    if (!payload || typeof payload.text !== 'string') {
      return { ok: false, message: 'invalid_text' }
    }
    return await manager.typeText(payload)
  } catch (error) {
    logLine('dictation_type_text_error', error.message)
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('dictation:get-focus-bounds', async () => {
  try {
    const manager = getDictationManager()
    const result = manager.getFocusBounds()
    if (result) {
      return { ok: true, ...result }
    }
    return { ok: false }
  } catch (error) {
    logLine('dictation_focus_bounds_error', error.message)
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('dictation:update-indicator', async (_event, payload = {}) => {
  try {
    const { visible = false, mode = 'recording', position = null } = payload || {}
    recordingIndicatorWindow.updateIndicator({ visible, mode, position })
    return { ok: true }
  } catch (error) {
    logLine('dictation_indicator_update_error', error.message)
    return { ok: false, message: error.message }
  }
})

ipcMain.handle('open-update-download', async () => {
  const manifest = getLatestManifest()
  try {
    logLine('update_open_request', {
      hasManifest: !!manifest,
      hasDownloadUrl: !!manifest?.downloadUrl,
      latestVersion: manifest?.latestVersion || null,
    })
  } catch (_) { }
  if (!manifest || !manifest.downloadUrl) {
    const error = new Error('No update download URL available')
    logLine('update_open_error', error.message)
    throw error
  }

  try {
    const parsed = new URL(manifest.downloadUrl)
    const allowedHost = 'github.com'
    try {
      logLine('update_open_validate', {
        downloadUrl: parsed.toString(),
        protocol: parsed.protocol,
        hostname: parsed.hostname,
      })
    } catch (_) { }
    if (parsed.protocol !== 'https:' || parsed.hostname !== allowedHost) {
      throw new Error(`Blocked download URL: ${parsed.toString()}`)
    }

    await shell.openExternal(parsed.toString())
    logLine('update_open_launch', parsed.toString())
    return { ok: true }
  } catch (error) {
    logLine('update_open_error', error.message)
    throw error
  }
})
function getDictationManager() {
  if (!dictationManager) {
    dictationManager = new DictationManager({
      logger: (level, message, meta) => {
        try {
          logLine(`dictation_manager_${level}`, message, meta || {})
        } catch (_) { }
      },
    })

    dictationManager.on('dictation:press-start', () => {
      recordingIndicatorWindow.updateIndicator({ visible: true, mode: 'recording' })
    })
    dictationManager.on('dictation:press-end', () => {
      recordingIndicatorWindow.updateIndicator({ visible: true, mode: 'processing' })
    })
    dictationManager.on('dictation:press-cancel', () => {
      recordingIndicatorWindow.hideWindow()
    })
    dictationManager.on('dictation:permission-denied', () => {
      recordingIndicatorWindow.hideWindow()
    })
    dictationManager.on('dictation:listener-fallback', () => {
      recordingIndicatorWindow.hideWindow()
    })
    dictationManager.on('dictation:auto-paste-success', () => {
      recordingIndicatorWindow.hideWindow()
    })
  }
  return dictationManager
}
function broadcastDictationLifecycle(eventName, payload) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    try {
      win.webContents.send('dictation:lifecycle', { event: eventName, payload })
    } catch (error) {
      logLine('dictation_lifecycle_broadcast_error', error.message)
    }
  })
}
