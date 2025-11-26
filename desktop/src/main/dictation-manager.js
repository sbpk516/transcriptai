const EventEmitter = require('events')
const { clipboard, screen } = require('electron')

let clipboardTipLogged = false

const { createGlobalKeyListenerFactory } = require('./global-key-listener')

const PERMISSION_TIMEOUT_MS = 5000
const STUCK_KEY_TIMEOUT_MS = 90_000

function createLogger(bridge) {
  const emit = (level, message, meta) => {
    try {
      if (bridge && typeof bridge === 'function') {
        bridge(level, message, meta)
        return
      }
      if (bridge && typeof bridge.log === 'function') {
        bridge.log(level, message, meta)
        return
      }
    } catch (error) {
      console.error('[DictationManager] logger bridge failed', error)
    }

    const payload = meta ? `${message} ${JSON.stringify(meta)}` : message
    if (level === 'error') {
      console.error(`[DictationManager] ${payload}`)
    } else if (level === 'warn') {
      console.warn(`[DictationManager] ${payload}`)
    } else {
      console.log(`[DictationManager] ${payload}`)
    }
  }

  return {
    debug(message, meta) {
      emit('debug', message, meta)
    },
    info(message, meta) {
      emit('info', message, meta)
    },
    warn(message, meta) {
      emit('warn', message, meta)
    },
    error(message, meta) {
      emit('error', message, meta)
    }
  }
}

class DictationManager extends EventEmitter {
  constructor({ logger, listenerFactory } = {}) {
    super()
    this._log = createLogger(logger)
    this._config = null
    this._active = false
    this._disposed = false
    this._nut = null
    this._keyboard = null
    this._globalListener = null
    this._listenerFactory = listenerFactory || null
    this._listenerCallback = null
    this._listenerStarted = false
    this._keyEnum = null
    this._resolvedShortcut = null
    this._state = 'idle'
    this._lastEventTs = 0
    this._targetKeySet = new Set()
    this._activeKeySet = new Set()
    this._pressStartedAt = null
    this._permissionRequestSeq = 0
    this._pendingPermission = null
    this._stuckKeyTimer = null
  }

  async typeText(payload = {}) {
    let text = ''
    let mode = 'type'

    if (typeof payload === 'string') {
      text = payload
    } else if (payload && typeof payload === 'object') {
      if (typeof payload.text === 'string') {
        text = payload.text
      }
      if (typeof payload.mode === 'string') {
        mode = payload.mode
      }
    }

    if (!text) {
      this._log.warn('typeText invoked without text')
      return { ok: false, reason: 'empty_text' }
    }

    try {
      this._log.debug('typeText requested', { text, length: text.length, mode })

      if (mode === 'paste') {
        const pasteResult = await this._attemptAutoPaste(text)
        if (pasteResult.ok) {
          return pasteResult
        }
        this._log.warn('typeText auto-paste fallback to typing', {
          reason: pasteResult.reason || 'unknown',
        })
      }

      if (process.env.TRANSCRIPTAI_DICTATION_USE_CLIPBOARD === '1' && mode !== 'paste') {
        if (!clipboardTipLogged) {
          clipboardTipLogged = true
          this._log.info('dictation clipboard fallback enabled', {
            instructions: [
              'Focus the target app',
              'Run dictation so text copies to clipboard',
              'Press Cmd+V (or Ctrl+V on Windows/Linux) to paste the transcript',
            ],
          })
        }
        try {
          clipboard.writeText(text)
          this._log.info('typeText clipboard fallback', { length: text.length })
          this.emit('dictation:auto-paste-success')
          return { ok: true, method: 'clipboard' }
        } catch (clipboardError) {
          this._log.warn('typeText clipboard fallback failed, retrying with keyboard', {
            error: clipboardError.message,
          })
        }
      }

      if (!this._ensureKeyboardReady('typing') || !this._keyboard || typeof this._keyboard.type !== 'function') {
        this._log.error('typeText missing keyboard type function')
        return { ok: false, reason: 'keyboard_unavailable' }
      }
      await this._keyboard.type(text)
      this._log.info('typeText completed', { length: text.length })
      if (mode === 'paste') {
        this.emit('dictation:auto-paste-success')
      }
      return { ok: true, method: 'keyboard' }
    } catch (error) {
      this._log.error('typeText failed', { error: error.message })
      return { ok: false, reason: 'exception', error: error.message }
    }
  }

  async startListening(initialConfig = {}) {
    if (this._disposed) {
      this._log.warn('startListening requested after dispose, ignoring')
      return
    }
    if (this._active) {
      this._log.debug('startListening requested while already active')
      return
    }

    if (!this._nut) {
      try {
        // Lazy load to avoid slowing down app startup if dictation stays disabled
        // eslint-disable-next-line global-require
        this._nut = require('@nut-tree-fork/nut-js')
        this._keyboard = this._nut.keyboard
        this._log.info('nut-js loaded for dictation manager')
      } catch (error) {
        this._log.error('failed to load @nut-tree-fork/nut-js', { error: error.message })
        return
      }
    }
    if (!this._keyboard && this._nut && this._nut.keyboard) {
      this._keyboard = this._nut.keyboard
    }
    if (this._keyboard) {
      this._configureKeyboardDelay(0)
    }

    if (!this._listenerFactory) {
      try {
        this._listenerFactory = createGlobalKeyListenerFactory()
        this._log.info('node-global-key-listener loaded for dictation manager')
      } catch (error) {
        this._log.error('failed to load node-global-key-listener', { error: error.message })
        return
      }
    }

    if (!this._keyboard) {
      this._log.error('nut-js keyboard unavailable, aborting start')
      return
    }

    this._config = { ...initialConfig }
    if (this._config.shortcut) {
      const resolved = this._parseShortcut(this._config.shortcut)
      if (!resolved.ok) {
        this._log.error('failed to parse dictation shortcut', {
          shortcut: this._config.shortcut,
          reason: resolved.reason,
          tokens: resolved.tokens,
        })
        this._resolvedShortcut = null
        return
      }
      this._resolvedShortcut = resolved
    } else {
      this._resolvedShortcut = null
      this._log.warn('startListening invoked without shortcut configuration')
      return
    }
    this._targetKeySet = new Set(this._resolvedShortcut.keys)
    this._activeKeySet.clear()
    this._pressStartedAt = null

    const listenersAttached = await this._attachListeners()
    if (!listenersAttached) {
      this._targetKeySet.clear()
      this._resolvedShortcut = null
      return
    }

    this._active = true
    this._log.info('dictation manager listening started (bootstrap)', {
      shortcut: this._config.shortcut || null,
      keys: Array.from(this._targetKeySet),
    })
    return this._active
  }

  async stopListening() {
    if (!this._active) {
      this._log.debug('stopListening requested while manager inactive')
      return
    }

    await this._detachListeners()
    this._destroyGlobalListener()
    this._active = false
    this._resolvedShortcut = null
    this._state = 'idle'
    this._lastEventTs = 0
    this._targetKeySet.clear()
    this._activeKeySet.clear()
    this._pressStartedAt = null
    this._clearPendingPermission({ reason: 'manager_stopped' })
    this._clearStuckKeyTimer()
    this._log.info('dictation manager listening stopped (scaffold)')
  }

  cancelActivePress({ reason = 'renderer_cancelled', details = {} } = {}) {
    if (this._disposed) {
      this._log.warn('cancelActivePress invoked after dispose', { reason })
      return false
    }
    if (!this._active) {
      this._log.debug('cancelActivePress invoked while inactive', { reason })
      return false
    }
    if (this._state === 'idle') {
      this._log.debug('cancelActivePress invoked with idle state', { reason })
      return false
    }

    this._log.info('cancelActivePress invoked', { reason, details })
    this._cancelPress(reason, { source: 'renderer', ...details })
    return true
  }

  _configureKeyboardDelay(delayMs = 0) {
    if (!this._keyboard) {
      return
    }

    if (this._keyboard.config && typeof this._keyboard.config === 'object') {
      this._keyboard.config.autoDelayMs = delayMs
    }

    try {
      const registry = this._keyboard.providerRegistry
      if (registry && typeof registry.hasKeyboard === 'function' && registry.hasKeyboard()) {
        const provider = registry.getKeyboard?.()
        if (provider && typeof provider.setKeyboardDelay === 'function') {
          provider.setKeyboardDelay(delayMs)
          this._log.debug('dictation keyboard delay configured', { delayMs })
        }
      }
    } catch (error) {
      this._log.warn('failed to configure keyboard delay', { error: error.message })
    }
  }

  _ensureKeyboardReady(context = 'typing') {
    if (!this._nut) {
      try {
        // eslint-disable-next-line global-require
        this._nut = require('@nut-tree-fork/nut-js')
        this._keyboard = this._nut.keyboard
        this._log.info(`nut-js loaded for dictation ${context}`)
      } catch (error) {
        this._log.error('failed to load @nut-tree-fork/nut-js', { context, error: error.message })
        return false
      }
    }
    if (!this._keyboard && this._nut && this._nut.keyboard) {
      this._keyboard = this._nut.keyboard
    }
    if (this._keyboard) {
      this._configureKeyboardDelay(0)
    }
    return !!this._keyboard
  }

  async _attemptAutoPaste(text) {
    if (!this._ensureKeyboardReady('auto_paste') || !this._keyboard || !this._nut) {
      return { ok: false, reason: 'keyboard_unavailable' }
    }

    const { Key } = this._nut
    if (!Key || Key.V === undefined) {
      return { ok: false, reason: 'key_mapping_unavailable' }
    }

    const isMac = process.platform === 'darwin'
    const modifier =
      (isMac && (Key.LeftCmd ?? Key.LeftSuper ?? Key.LeftMeta)) ??
      Key.LeftControl ??
      Key.LeftCtrl ??
      Key.LeftMeta

    if (modifier === undefined) {
      return { ok: false, reason: 'modifier_unavailable' }
    }

    try {
      clipboard.writeText(text)
    } catch (error) {
      return {
        ok: false,
        reason: 'clipboard_write_failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    try {
      await this._keyboard.type(modifier, Key.V)
      await new Promise(resolve => setTimeout(resolve, 200))
      this._log.info('typeText auto-paste completed', { length: text.length })
      this.emit('dictation:auto-paste-success')
      return { ok: true, method: 'paste' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'paste_failed', error: message }
    }
  }

  getFocusBounds() {
    try {
      if (!screen || typeof screen.getCursorScreenPoint !== 'function') {
        this._log.debug('getFocusBounds unavailable – screen module missing')
        return null
      }
      const point = screen.getCursorScreenPoint()
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        return { x: point.x, y: point.y }
      }
    } catch (error) {
      this._log.debug('getFocusBounds failed', { error: error instanceof Error ? error.message : String(error) })
    }
    return null
  }

  async updateShortcut(patch = {}) {
    if (this._disposed) {
      this._log.warn('updateShortcut after dispose, ignoring')
      return
    }

    this._config = { ...(this._config || {}), ...patch }

    if (this._config.shortcut) {
      const resolved = this._parseShortcut(this._config.shortcut)
      if (!resolved.ok) {
        this._log.warn('received invalid shortcut configuration', {
          shortcut: this._config.shortcut,
          reason: resolved.reason,
          tokens: resolved.tokens,
        })
        return
      }
      this._resolvedShortcut = resolved
      this._targetKeySet = new Set(resolved.keys)
      this._log.debug('shortcut configuration updated (scaffold)', {
        shortcut: this._config.shortcut,
        keys: resolved.keys,
      })
    } else {
      this._resolvedShortcut = null
      this._targetKeySet.clear()
      this._log.debug('shortcut configuration cleared (scaffold)')
    }
  }

  async dispose() {
    if (this._disposed) {
      return
    }

    await this.stopListening()
    this._disposed = true
    this._destroyGlobalListener()
    this._nut = null
    this._keyboard = null
    this._keyEnum = null
    this._resolvedShortcut = null
    this._state = 'idle'
    this._lastEventTs = 0
    this._targetKeySet.clear()
    this._activeKeySet.clear()
   this._pressStartedAt = null
    this._clearPendingPermission({ reason: 'manager_disposed' })
    this._clearStuckKeyTimer()
    this.removeAllListeners()
    this._log.info('dictation manager disposed')
  }

  async _attachListeners() {
    if (!this._listenerFactory) {
      this._log.error('attachListeners called without listener factory')
      return false
    }
    if (!this._resolvedShortcut || !Array.isArray(this._resolvedShortcut.keys) || !this._resolvedShortcut.keys.length) {
      this._log.warn('attachListeners called without resolved shortcut keys')
      return false
    }

    if (!this._globalListener) {
      try {
        this._globalListener = new this._listenerFactory()
      } catch (error) {
        this._log.error('failed to instantiate global key listener', { error: error.message })
        this._destroyGlobalListener()
        return false
      }
    }

    if (this._listenerCallback && this._listenerStarted) {
      this._log.debug('global key listener already attached')
      return true
    }

    const handler = async (event) => {
      if (!event || !event.state) {
        return
      }
      
      // DEBUG: Log ALL raw events to diagnose Option key issue
      const rawName = event.name || (event.rawKey && event.rawKey.name) || 'unknown'
      this._log.debug('[DEBUG] raw key event received', {
        state: event.state,
        name: event.name,
        rawKeyName: event.rawKey && event.rawKey.name,
        vKey: event.vKey,
      })
      
      const keyCode = this._mapListenerEventToKey(event)
      if (keyCode === null || keyCode === undefined) {
        this._log.debug('[DEBUG] key mapping returned null', {
          rawName,
          state: event.state,
        })
        return
      }

      if (event.state === 'DOWN') {
        this._handleKeydown(keyCode, event)
      } else if (event.state === 'UP') {
        this._handleKeyup(keyCode, event)
      }
    }

    try {
      await this._globalListener.addListener(handler)
      this._listenerCallback = handler
      this._listenerStarted = true
      this._log.debug('global key listener attached', {
        shortcutKeys: Array.from(this._targetKeySet),
      })
      return true
    } catch (error) {
      this._log.error('failed to attach global key listener', { error: error.message })
      this._listenerStarted = false
      this._destroyGlobalListener()
      return false
    }
  }

  async _detachListeners() {
    if (this._globalListener && this._listenerCallback) {
      try {
        this._globalListener.removeListener(this._listenerCallback)
      } catch (error) {
        this._log.warn('failed to remove global key listener', { error: error.message })
      }
      this._listenerCallback = null
    }
    this._log.debug('global key listener detached')
  }

  _destroyGlobalListener() {
    if (this._listenerStarted && this._globalListener && typeof this._globalListener.kill === 'function') {
      try {
        this._globalListener.kill()
      } catch (error) {
        this._log.warn('failed to kill global key listener', { error: error.message })
      }
    }
    this._globalListener = null
    this._listenerCallback = null
    this._listenerStarted = false
  }

  _requestPermission(context = {}) {
    if (this._pendingPermission) {
      return
    }
    const requestId = ++this._permissionRequestSeq
    const payload = {
      requestId,
      timestamp: Date.now(),
      platform: process.platform,
      context,
    }
    this._pendingPermission = {
      id: requestId,
      createdAt: payload.timestamp,
      state: 'pending',
      timeout: setTimeout(() => {
        this._log.warn('dictation permission timeout', { requestId })
        this.denyPermission({ requestId, reason: 'timeout' })
      }, PERMISSION_TIMEOUT_MS)
    }
    this._log.info('dictation permission requested', payload)
    try {
      this.emit('dictation:request-start', payload)
    } catch (error) {
      this._log.error('failed to emit permission request', { error: error.message })
    }
  }

  grantPermission({ requestId, source } = {}) {
    const pending = this._pendingPermission
    if (!pending || (requestId && pending.id !== requestId)) {
      this._log.warn('grantPermission ignored', { requestId })
      return false
    }
    pending.state = 'granted'
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    this._pendingPermission = null
    const payload = {
      requestId: pending.id,
      timestamp: Date.now(),
      source,
    }
    this._log.info('dictation permission granted', payload)
    try {
      this.emit('dictation:permission-granted', payload)
    } catch (error) {
      this._log.error('failed to emit permission granted', { error: error.message })
    }
    return true
  }

  denyPermission({ requestId, reason } = {}) {
    const pending = this._pendingPermission
    if (!pending || (requestId && pending.id !== requestId)) {
      this._log.warn('denyPermission ignored', { requestId, reason })
      return false
    }
    pending.state = 'denied'
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    this._pendingPermission = null
    const payload = {
      requestId: pending.id,
      timestamp: Date.now(),
      reason: reason || 'unknown',
    }
    this._log.warn('dictation permission denied', payload)
    try {
      this.emit('dictation:permission-denied', payload)
    } catch (error) {
      this._log.error('failed to emit permission denied', { error: error.message })
    }
    this._cancelPress('permission_denied', { requestId: payload.requestId, reason: payload.reason })
    return true
  }

  _clearPendingPermission(meta = {}) {
    const pending = this._pendingPermission
    if (!pending) {
      return
    }
    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }
    this._pendingPermission = null
    const payload = {
      requestId: pending.id,
      timestamp: Date.now(),
      ...meta,
    }
    this._log.debug('dictation permission cleared', payload)
    try {
      this.emit('dictation:permission-cleared', payload)
    } catch (error) {
      this._log.error('failed to emit permission cleared', { error: error.message })
    }
  }

  _mapListenerEventToKey(event) {
    const Key = this._ensureKeyEnum()
    if (!Key || !event) {
      return null
    }

    const rawName = typeof event.name === 'string' && event.name.trim().length > 0
      ? event.name
      : (event.rawKey && typeof event.rawKey.name === 'string' ? event.rawKey.name : '')

    const normalized = rawName.trim().toLowerCase()
    if (!normalized) {
      return null
    }

    const normalizedSpace = normalized.replace(/\s+/g, ' ')
    const collapsed = normalizedSpace.replace(/\s+/g, '')

    if (/^[a-z]$/.test(normalizedSpace)) {
      const keyName = normalizedSpace.toUpperCase()
      return Key[keyName] !== undefined ? Key[keyName] : null
    }

    if (/^\d$/.test(normalizedSpace)) {
      const keyName = `Num${normalizedSpace}`
      return Key[keyName] !== undefined ? Key[keyName] : null
    }

    if (/^f\d{1,2}$/i.test(normalizedSpace)) {
      const keyName = normalizedSpace.toUpperCase()
      return Key[keyName] !== undefined ? Key[keyName] : null
    }

    if (/^numpad \d$/.test(normalizedSpace)) {
      const digit = normalizedSpace.split(' ')[1]
      const keyName = `NumPad${digit}`
      return Key[keyName] !== undefined ? Key[keyName] : null
    }

    const platform = process.platform

    switch (normalizedSpace) {
      case 'space':
        return Key.Space
      case 'backspace':
        return Key.Backspace
      case 'return':
        return Key.Return
      case 'enter':
        return Key.Enter
      case 'escape':
        return Key.Escape
      case 'tab':
        return Key.Tab
      case 'delete':
        return Key.Delete
      case 'backtick':
      case 'section':
        return Key.Grave
      case 'equals':
        return Key.Equal
      case 'minus':
        return Key.Minus
      case 'square bracket open':
        return Key.LeftBracket
      case 'square bracket close':
        return Key.RightBracket
      case 'semicolon':
        return Key.Semicolon
      case 'quote':
        return Key.Quote
      case 'backslash':
        return Key.Backslash
      case 'comma':
        return Key.Comma
      case 'dot':
      case 'period':
        return Key.Period
      case 'forward slash':
      case 'slash':
        return Key.Slash
      case 'up arrow':
        return Key.Up
      case 'down arrow':
        return Key.Down
      case 'left arrow':
        return Key.Left
      case 'right arrow':
        return Key.Right
      case 'page up':
        return Key.PageUp
      case 'page down':
        return Key.PageDown
      case 'home':
        return Key.Home
      case 'end':
        return Key.End
      case 'caps lock':
        return Key.CapsLock
      case 'scroll lock':
        return Key.ScrollLock
      case 'num lock':
        return Key.NumLock
      case 'ins':
      case 'insert':
        return Key.Insert
      case 'print screen':
        return Key.Print
      case 'fn':
        return Key.Fn
      case 'numpad divide':
        return Key.Divide
      case 'numpad multiply':
        return Key.Multiply
      case 'numpad minus':
        return Key.Subtract
      case 'numpad plus':
        return Key.Add
      case 'numpad return':
        return Key.Enter
      case 'numpad dot':
        return Key.Decimal
      case 'numpad clear':
        return Key.Clear
      case 'numpad equals':
        return Key.NumPadEqual
      case 'left shift':
      case 'shift left':
        return Key.LeftShift
      case 'right shift':
      case 'shift right':
        return Key.RightShift
      case 'left alt':
      case 'left option':
        return Key.LeftAlt
      case 'right alt':
      case 'right option':
      case 'alt gr':
        return Key.RightAlt
      case 'left ctrl':
      case 'left control':
        return Key.LeftControl
      case 'right ctrl':
      case 'right control':
        return Key.RightControl
      case 'left cmd':
      case 'left command':
      case 'left meta':
      case 'left win':
      case 'left super':
        return this._resolveMetaKey('left', platform, Key)
      case 'right cmd':
      case 'right command':
      case 'right meta':
      case 'right win':
      case 'right super':
        return this._resolveMetaKey('right', platform, Key)
      case 'meta':
      case 'command':
      case 'cmd':
      case 'super':
        return this._resolveMetaKey('left', platform, Key)
      default:
        break
    }

    if (collapsed && Key[collapsed.toUpperCase()] !== undefined) {
      return Key[collapsed.toUpperCase()]
    }

    return null
  }

  _resolveMetaKey(side, platform, Key) {
    const left = side === 'left'
    if (platform === 'darwin') {
      const candidate = left ? Key.LeftCmd : Key.RightCmd
      if (candidate !== undefined) return candidate
    } else if (platform === 'win32') {
      const candidate = left ? Key.LeftWin : Key.RightWin
      if (candidate !== undefined) return candidate
    } else {
      const candidate = left ? Key.LeftSuper : Key.RightSuper
      if (candidate !== undefined) return candidate
    }
    const fallback = left ? Key.LeftMeta : Key.RightMeta
    return fallback !== undefined ? fallback : null
  }

  _handleKeydown(keyCode, rawEvent = {}) {
    const now = Date.now()
    if (this._shouldIgnoreEvent(now, rawEvent.state)) {
      return
    }

    if (!this._targetKeySet.has(keyCode)) {
      if (this._state === 'pressed') {
        this._cancelPress('non_shortcut_key_down', { keyCode })
      }
      return
    }

    this._activeKeySet.add(keyCode)
    this._log.debug('key down detected for dictation', {
      keyCode,
      activeKeys: Array.from(this._activeKeySet),
      state: this._state,
    })

    if (this._state === 'idle' && this._isShortcutSatisfied()) {
      this._pressStartedAt = now
      this._transitionState('pressed', { keyCode, rawEvent })
      this._log.info('dictation shortcut satisfied – press started', {
        timestamp: now,
        keys: Array.from(this._activeKeySet),
      })
      this._emitLifecycle('dictation:press-start', {
        timestamp: now,
        durationMs: 0,
      })
      this._requestPermission({ keyCode, rawEvent })
      this._armStuckKeyTimer()
    } else if (this._state === 'armed') {
      // Re-enter pressed state if modifiers recover while still holding primary key
      if (this._isShortcutSatisfied()) {
        this._transitionState('pressed', { keyCode, rawEvent, reason: 'recovered' })
        this._armStuckKeyTimer()
      }
    }
  }

  _handleKeyup(keyCode, rawEvent = {}) {
    const now = Date.now()
    if (this._shouldIgnoreEvent(now, rawEvent.state)) {
      return
    }

    if (!this._targetKeySet.has(keyCode)) {
      return
    }

    this._activeKeySet.delete(keyCode)

    if (this._state === 'pressed') {
      this._transitionState('armed', { keyCode, rawEvent })
      this._log.debug('dictation shortcut primary key released – armed state', {
        keyCode,
        remainingKeys: Array.from(this._activeKeySet),
      })
    }

    if (this._activeKeySet.size === 0) {
      if (this._state === 'armed') {
        const duration = this._pressStartedAt ? now - this._pressStartedAt : 0
        this._transitionState('idle', { keyCode, rawEvent })
        this._log.info('dictation shortcut released – ending press', {
          timestamp: now,
          durationMs: duration,
        })
        this._emitLifecycle('dictation:press-end', {
          timestamp: now,
          durationMs: duration,
        })
      } else if (this._state === 'pressed') {
        // Shortcut released without transitioning to armed (single key combos)
        const duration = this._pressStartedAt ? now - this._pressStartedAt : 0
        this._transitionState('idle', { keyCode, rawEvent, reason: 'direct_release' })
        this._emitLifecycle('dictation:press-end', {
          timestamp: now,
          durationMs: duration,
        })
      } else if (this._state !== 'idle') {
        this._cancelPress('unexpected_release', { keyCode })
      }
      this._pressStartedAt = null
      this._activeKeySet.clear()
      this._clearStuckKeyTimer()
    }
  }

  _cancelPress(reason, meta = {}) {
    this._clearStuckKeyTimer()
    if (this._state === 'idle') {
      return
    }
    this._transitionState('idle', { reason, ...meta })
    this._activeKeySet.clear()
    this._pressStartedAt = null
    this._emitLifecycle('dictation:press-cancel', { reason, timestamp: Date.now(), ...meta })
  }

  _emitLifecycle(eventName, payload) {
    try {
      if (eventName === 'dictation:press-start') {
        this._log.info('dictation lifecycle start', payload)
      } else if (eventName === 'dictation:press-end') {
        this._log.info('dictation lifecycle end', payload)
      } else if (eventName === 'dictation:press-cancel') {
        this._log.warn('dictation lifecycle cancel', payload)
      } else {
        this._log.debug('dictation lifecycle event', { eventName, payload })
      }
    } catch (_) {}
    try {
      this.emit(eventName, payload)
    } catch (error) {
      this._log.error('failed to emit lifecycle event', { eventName, error: error.message })
    }
  }

  _isShortcutSatisfied() {
    if (!this._targetKeySet.size) {
      return false
    }
    for (const key of this._targetKeySet) {
      if (!this._activeKeySet.has(key)) {
        return false
      }
    }
    return true
  }

  _transitionState(next, meta = {}) {
    if (this._state === next) {
      return
    }
    const previous = this._state
    this._state = next
    this._lastEventTs = Date.now()
    this._log.debug('state transition', { previous, next, ...meta })
  }

  _shouldIgnoreEvent(now = Date.now(), state = null) {
    if (state === 'UP') {
      return false
    }
    const diff = now - this._lastEventTs
    if (diff >= 0 && diff < 10) {
      this._log.debug('debounce: ignoring event', { diff })
      return true
    }
    return false
  }

  _armStuckKeyTimer() {
    if (!STUCK_KEY_TIMEOUT_MS || STUCK_KEY_TIMEOUT_MS <= 0) {
      return
    }
    this._clearStuckKeyTimer()
    this._stuckKeyTimer = setTimeout(() => {
      this._handleStuckKeyTimeout()
    }, STUCK_KEY_TIMEOUT_MS)
  }

  _clearStuckKeyTimer() {
    if (this._stuckKeyTimer) {
      clearTimeout(this._stuckKeyTimer)
      this._stuckKeyTimer = null
    }
  }

  _handleStuckKeyTimeout() {
    this._stuckKeyTimer = null
    if (this._state !== 'pressed' || !this._activeKeySet.size) {
      return
    }

    const stuckKeys = Array.from(this._activeKeySet)
    this._log.warn('stuck key detected - cancelling press', { stuckKeys })
    this._cancelPress('stuck_key_timeout', { stuckKeys })
    try {
      this.emit('dictation:stuck-key', {
        timestamp: Date.now(),
        stuckKeys,
        reason: 'timeout',
      })
    } catch (error) {
      this._log.error('failed to emit stuck-key event', { error: error.message })
    }
  }

  _parseShortcut(accelerator) {
    if (typeof accelerator !== 'string') {
      return { ok: false, reason: 'non_string' }
    }

    const trimmed = accelerator.trim()
    if (!trimmed) {
      return { ok: false, reason: 'empty' }
    }

    const keyEnum = this._ensureKeyEnum()
    if (!keyEnum) {
      return { ok: false, reason: 'key_enum_unavailable' }
    }

    const rawTokens = trimmed.split('+').map(token => token.trim()).filter(Boolean)
    if (!rawTokens.length) {
      return { ok: false, reason: 'empty' }
    }

    const tokens = []
    const resolvedKeys = []
    const unsupported = []

    for (const token of rawTokens) {
      const resolution = this._resolveToken(token, keyEnum)
      if (!resolution) {
        unsupported.push(token)
        continue
      }
      tokens.push(token)
      resolvedKeys.push(...resolution)
    }

    if (unsupported.length) {
      return { ok: false, reason: 'unsupported_tokens', tokens: unsupported }
    }

    return { ok: true, tokens, keys: resolvedKeys }
  }

  _ensureKeyEnum() {
    if (this._keyEnum) {
      return this._keyEnum
    }

    if (this._nut && this._nut.Key) {
      this._keyEnum = this._nut.Key
      return this._keyEnum
    }

    try {
      // eslint-disable-next-line global-require
      const shared = require('@nut-tree-fork/shared')
      if (shared && shared.Key) {
        this._keyEnum = shared.Key
        return this._keyEnum
      }
    } catch (error) {
      this._log.error('failed to load nut-js key enum', { error: error.message })
    }

    return null
  }

  _resolveToken(token, Key) {
    const normalized = token.trim().toLowerCase()
    if (!normalized) {
      return null
    }

    const platform = process.platform

    const directKeyName = this._lookupDirectKeyName(normalized, platform)
    if (directKeyName && Key[directKeyName] !== undefined) {
      return [Key[directKeyName]]
    }

    if (/^f\d{1,2}$/i.test(normalized)) {
      const fnName = normalized.toUpperCase()
      if (Key[fnName] !== undefined) {
        return [Key[fnName]]
      }
    }

    if (/^[a-z]$/.test(normalized)) {
      const letterName = normalized.toUpperCase()
      if (Key[letterName] !== undefined) {
        return [Key[letterName]]
      }
    }

    if (/^\d$/.test(normalized)) {
      const digitName = `Num${normalized}`
      if (Key[digitName] !== undefined) {
        return [Key[digitName]]
      }
    }

    return null
  }

  _lookupDirectKeyName(normalized, platform) {
    switch (normalized) {
      case 'commandorcontrol':
        return platform === 'darwin' ? 'LeftCmd' : 'LeftControl'
      case 'control':
      case 'ctrl':
        return 'LeftControl'
      case 'command':
      case 'cmd':
        return 'LeftCmd'
      case 'super':
        return 'LeftSuper'
      case 'meta':
        return 'LeftMeta'
      case 'win':
      case 'windows':
        return 'LeftWin'
      case 'alt':
      case 'option':
        return 'LeftAlt'
      case 'altgr':
        return 'RightAlt'
      case 'optionoralt':
        return 'LeftAlt'
      case 'shift':
        return 'LeftShift'
      case 'rightshift':
        return 'RightShift'
      case 'leftshift':
        return 'LeftShift'
      case 'space':
        return 'Space'
      case 'tab':
        return 'Tab'
      case 'enter':
        return 'Enter'
      case 'return':
        return 'Return'
      case 'backspace':
        return 'Backspace'
      case 'delete':
        return 'Delete'
      case 'escape':
      case 'esc':
        return 'Escape'
      case 'pageup':
        return 'PageUp'
      case 'pagedown':
        return 'PageDown'
      case 'home':
        return 'Home'
      case 'end':
        return 'End'
      case 'left':
        return 'Left'
      case 'right':
        return 'Right'
      case 'up':
        return 'Up'
      case 'down':
        return 'Down'
      case 'capslock':
        return 'CapsLock'
      case 'minus':
      case 'dash':
      case 'hyphen':
        return 'Minus'
      case 'equals':
      case 'equal':
        return 'Equal'
      case 'plus':
        return 'Add'
      case 'multiply':
        return 'Multiply'
      case 'divide':
        return 'Divide'
      case 'subtract':
        return 'Subtract'
      case 'comma':
        return 'Comma'
      case 'period':
      case 'dot':
        return 'Period'
      case 'slash':
        return 'Slash'
      case 'backslash':
        return 'Backslash'
      case 'semicolon':
        return 'Semicolon'
      case 'quote':
        return 'Quote'
      case 'grave':
      case 'tilde':
        return 'Grave'
      case 'menu':
        return 'Menu'
      default:
        return null
    }
  }
}

module.exports = DictationManager
