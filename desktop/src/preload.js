const { contextBridge, ipcRenderer } = require('electron')

const UPDATE_EVENT = 'update-available'
const DICTATION_SETTINGS_EVENT = 'dictation:settings-updated'

const updateListeners = new Set()
const dictationSettingsListeners = new Set()
const dictationLifecycleListeners = new Set()
const dictationPermissionListeners = new Set()

let latestManifest = null
let latestDictationSettings = null
let latestLifecycleEvent = null
let latestPermissionRequest = null

ipcRenderer.on('dictation:lifecycle', (_event, eventData) => {
  // DEBUG: Log all lifecycle events
  console.log('[Preload DEBUG] dictation:lifecycle received', {
    event: eventData?.event,
    hasPayload: !!eventData?.payload,
    listenerCount: dictationLifecycleListeners.size,
  })
  
  latestLifecycleEvent = eventData
  const lifecycleEvent = eventData && eventData.event
  const lifecyclePayload = eventData && eventData.payload
  if (lifecycleEvent === 'dictation:permission-required') {
    latestPermissionRequest = lifecyclePayload || null
    dictationPermissionListeners.forEach((listener) => {
      try {
        listener({ type: lifecycleEvent, payload: lifecyclePayload })
      } catch (error) {
        console.error('[Preload] dictation permission listener failed', error)
      }
    })
  } else if (
    lifecycleEvent === 'dictation:permission-granted' ||
    lifecycleEvent === 'dictation:permission-denied' ||
    lifecycleEvent === 'dictation:permission-cleared' ||
    lifecycleEvent === 'dictation:listener-fallback'
  ) {
    latestPermissionRequest = null
    dictationPermissionListeners.forEach((listener) => {
      try {
        listener({ type: lifecycleEvent, payload: lifecyclePayload })
      } catch (error) {
        console.error('[Preload] dictation permission listener failed', error)
      }
    })
  }
  // DEBUG: Broadcast to all lifecycle listeners
  console.log('[Preload DEBUG] Broadcasting to lifecycle listeners', {
    listenerCount: dictationLifecycleListeners.size,
    event: eventData?.event,
  })
  
  dictationLifecycleListeners.forEach((listener) => {
    try {
      // FIX: Transform event structure - frontend expects 'type' not 'event'
      listener({ type: lifecycleEvent, payload: lifecyclePayload })
    } catch (error) {
      console.error('[Preload] dictation lifecycle listener failed', error)
    }
  })
})

ipcRenderer.on(UPDATE_EVENT, (_event, manifest) => {
  latestManifest = manifest
  try {
    console.log('[Preload] update available', manifest)
  } catch (_) {}
  updateListeners.forEach((listener) => {
    try {
      listener(manifest)
    } catch (error) {
      console.error('[Preload] update listener failed', error)
    }
  })
})

ipcRenderer.on(DICTATION_SETTINGS_EVENT, (_event, settings) => {
  latestDictationSettings = settings
  dictationSettingsListeners.forEach((listener) => {
    try {
      listener(settings)
    } catch (error) {
      console.error('[Preload] dictation settings listener failed', error)
    }
  })
})

// Minimal, safe bridge
// Expose minimal, safe API
const backendInfoSync = (() => {
  try {
    return ipcRenderer.sendSync('get-backend-info-sync') || {}
  } catch (_) {
    return {}
  }
})()

// Listen for backend-ready event (optional - frontend already polls)
ipcRenderer.on('backend-ready', (_event, data) => {
  // Frontend can listen to this event if needed, but polling is already implemented
  console.log('[Preload] Backend ready event received', data)
})

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
  getBackendInfo: () => ipcRenderer.invoke('get-backend-info'),
  backend: backendInfoSync,
  // Optional: expose backend-ready listener
  onBackendReady: (callback) => {
    if (typeof callback !== 'function') {
      console.warn('[Preload] onBackendReady expects a function callback')
      return () => {}
    }
    const handler = (_event, data) => {
      try {
        callback(data)
      } catch (error) {
        console.error('[Preload] backend-ready callback failed', error)
      }
    }
    ipcRenderer.on('backend-ready', handler)
    return () => ipcRenderer.removeListener('backend-ready', handler)
  },
})

contextBridge.exposeInMainWorld('transcriptaiUpdates', {
  onAvailable(callback) {
    if (typeof callback !== 'function') {
      console.warn('[Preload] onAvailable expects a function callback')
      return () => {}
    }
    updateListeners.add(callback)
    if (latestManifest) {
      try {
        callback(latestManifest)
      } catch (error) {
        console.error('[Preload] immediate update callback failed', error)
      }
    }
    return () => updateListeners.delete(callback)
  },
  getLatestManifest() {
    return latestManifest
  },
  openDownload() {
    try {
      console.log('[Preload] openDownload invoked', {
        hasManifest: !!latestManifest,
        hasDownloadUrl: !!latestManifest?.downloadUrl,
        latestVersion: latestManifest?.latestVersion,
      })
    } catch (_) {}
    if (!latestManifest || !latestManifest.downloadUrl) {
      console.warn('[Preload] openDownload called without a manifest')
      return Promise.reject(new Error('No manifest available for download'))
    }
    try {
      console.log('[Preload] openDownload dispatching IPC request', {
        downloadUrl: latestManifest.downloadUrl,
      })
    } catch (_) {}
    return ipcRenderer
      .invoke('open-update-download')
      .then((result) => {
        try {
          console.log('[Preload] openDownload resolved', result)
        } catch (_) {}
        return result
      })
      .catch((error) => {
        console.error('[Preload] Failed to launch update download', error)
        throw error
      })
  },
})

contextBridge.exposeInMainWorld('transcriptaiDictation', {
  async getSettings() {
    try {
      const settings = await ipcRenderer.invoke('dictation:get-settings')
      latestDictationSettings = settings
      return settings
    } catch (error) {
      console.error('[Preload] Failed to get dictation settings', error)
      throw error
    }
  },
  async updateSettings(patch) {
    try {
      const settings = await ipcRenderer.invoke('dictation:set-settings', patch)
      latestDictationSettings = settings
      return settings
    } catch (error) {
      console.error('[Preload] Failed to update dictation settings', error)
      throw error
    }
  },
  onSettingsUpdated(callback) {
    if (typeof callback !== 'function') {
      console.warn('[Preload] onSettingsUpdated expects a function callback')
      return () => {}
    }
    dictationSettingsListeners.add(callback)
    if (latestDictationSettings) {
      try {
        callback(latestDictationSettings)
      } catch (error) {
        console.error('[Preload] immediate dictation callback failed', error)
      }
    }
    return () => dictationSettingsListeners.delete(callback)
  },
  getCachedSettings() {
    return latestDictationSettings
  },
  onLifecycle(callback) {
    if (typeof callback !== 'function') {
      console.warn('[Preload] onLifecycle expects a function callback')
      return () => {}
    }
    console.log('[Preload DEBUG] onLifecycle: registering listener', {
      listenerCount: dictationLifecycleListeners.size + 1,
    })
    dictationLifecycleListeners.add(callback)
    if (latestLifecycleEvent) {
      try {
        console.log('[Preload DEBUG] Calling new listener with cached event', latestLifecycleEvent?.event)
        callback(latestLifecycleEvent)
      } catch (error) {
        console.error('[Preload] immediate lifecycle callback failed', error)
      }
    }
    return () => {
      console.log('[Preload DEBUG] onLifecycle: unregistering listener')
      dictationLifecycleListeners.delete(callback)
    }
  },
  getLatestLifecycle() {
    return latestLifecycleEvent
  },
  onPermissionRequired(callback) {
    if (typeof callback !== 'function') {
      console.warn('[Preload] onPermissionRequired expects a function callback')
      return () => {}
    }
    dictationPermissionListeners.add(callback)
    if (latestPermissionRequest) {
      try {
        callback({ type: 'dictation:permission-required', payload: latestPermissionRequest })
      } catch (error) {
        console.error('[Preload] immediate permission callback failed', error)
      }
    }
    return () => dictationPermissionListeners.delete(callback)
  },
  getLatestPermissionRequest() {
    return latestPermissionRequest
  },
  async respondPermission(response) {
    try {
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid permission response payload')
      }
      return await ipcRenderer.invoke('dictation:permission-response', response)
    } catch (error) {
      console.error('[Preload] Failed to send permission response', error)
      throw error
    }
  },
  async cancelActivePress(payload = {}) {
    try {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid cancel payload')
      }
      return await ipcRenderer.invoke('dictation:cancel-active-press', payload)
    } catch (error) {
      console.error('[Preload] Failed to request dictation cancel', error)
      throw error
    }
  },
  async typeText(payload = {}) {
    try {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid type payload')
      }
      return await ipcRenderer.invoke('dictation:type-text', payload)
    } catch (error) {
      console.error('[Preload] Failed to request dictation typeText', error)
      throw error
    }
  },
  async getFocusBounds() {
    try {
      const result = await ipcRenderer.invoke('dictation:get-focus-bounds')
      if (result && result.ok && typeof result.x === 'number' && typeof result.y === 'number') {
        return { x: result.x, y: result.y }
      }
      return null
    } catch (error) {
      console.error('[Preload] Failed to get focus bounds', error)
      return null
    }
  },
  async getMacPermissions() {
    try {
      return await ipcRenderer.invoke('dictation:get-mac-permissions')
    } catch (error) {
      console.error('[Preload] Failed to get Mac permissions', error)
      throw error
    }
  },
  async requestMacPermissions() {
    try {
      return await ipcRenderer.invoke('dictation:request-mac-permissions')
    } catch (error) {
      console.error('[Preload] Failed to request Mac permissions', error)
      throw error
    }
  },
})
