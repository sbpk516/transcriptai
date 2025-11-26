import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildSnippetPayload,
  submitDictationSnippetWithRetry,
} from './dictationService'
import type { DictationSnippetPayload } from './dictationService'
import {
  insertDictationText,
  snapshotActiveEditable,
  type EditableTargetSnapshot,
} from './textInsertion'

let dictationDebugInstructionsLogged = false

type DictationStatus = 'idle' | 'permission' | 'recording' | 'processing' | 'error'

interface DictationPermissionState {
  requestId: number | null
  accessibilityOk: boolean
  micOk: boolean
}

type DictationEvent = {
  type: string
  payload?: Record<string, unknown>
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type NotificationSeverity = 'info' | 'warning' | 'error'

export interface DictationProcessingSnapshot {
  requestId: string | null
  attempt: number
  startedAt: number | null
  lastError: string | null
}

export interface DictationNotification {
  id: string
  severity: NotificationSeverity
  title: string
  message: string
  autoCloseMs?: number | null
}

interface SafeModeState {
  engaged: boolean
  reason: string | null
  fatalErrorCount: number
  lastErrorId: string | null
  detail: string | null
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
  },
}

const RECORDER_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
const MAX_RECORDING_DURATION_MS = 120_000

interface DictationInternalState {
  status: DictationStatus
  transcript: string
  confidence: number
  error: string | null
  isEnabled: boolean
  processing: DictationProcessingSnapshot
  permission: DictationPermissionState | null
  indicatorPosition: { x: number; y: number } | null
}

export interface DictationControllerState extends DictationInternalState {
  notifications: DictationNotification[]
  safeMode: SafeModeState
  dismissNotification: (id: string) => void
  clearNotifications: () => void
  exitSafeMode: () => Promise<void>
}

const initialProcessingSnapshot: DictationProcessingSnapshot = {
  requestId: null,
  attempt: 0,
  startedAt: null,
  lastError: null,
}

const initialState: DictationInternalState = {
  status: 'idle',
  transcript: '',
  confidence: 0,
  error: null,
  isEnabled: false,
  processing: { ...initialProcessingSnapshot },
  permission: null,
  indicatorPosition: null,
}

export function useDictationController(): DictationControllerState {
  const [state, setState] = useState<DictationInternalState>(initialState)
  const permissionUnsubscribe = useRef<() => void>(() => {})
  const lifecycleUnsubscribe = useRef<() => void>(() => {})
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const bufferedChunksRef = useRef<BlobPart[]>([])
  const watchdogTimerRef = useRef<number | null>(null)
  const recorderMimeTypeRef = useRef<string | null>(null)
  const pendingSnippetRef = useRef<DictationSnippetPayload | null>(null)
  const activeUploadAbortRef = useRef<AbortController | null>(null)
  const pendingPressRef = useRef<DictationEvent['payload'] | null>(null)
  const releaseTargetRef = useRef<EditableTargetSnapshot | null>(null)
  const lastIndicatorFetchRef = useRef<number>(0)
  const waitingForPermissionRef = useRef(false)
  const recordingStartInFlightRef = useRef(false)
  const notificationTimersRef = useRef<Map<string, number>>(new Map())
  const lastInsertedTranscriptRef = useRef<string | null>(null)
  const [notifications, setNotifications] = useState<DictationNotification[]>([])
  const [safeMode, setSafeMode] = useState<SafeModeState>({
    engaged: false,
    reason: null,
    fatalErrorCount: 0,
    lastErrorId: null,
    detail: null,
  })
  const fatalErrorRef = useRef<{ count: number; lastErrorId: string | null }>({ count: 0, lastErrorId: null })
  const dictationBridge = (window as unknown as { transcriptaiDictation?: any })?.transcriptaiDictation || null

  const log = useCallback((level: LogLevel, message: string, meta: Record<string, unknown> = {}) => {
    const logger = (console[level] as typeof console.log) || console.log
    if (Object.keys(meta).length > 0) {
      logger('[DictationController]', message, meta)
      return
    }
    logger('[DictationController]', message)
  }, [])

  const updateDesktopIndicator = useCallback((visible: boolean, mode: 'recording' | 'processing', position: { x: number; y: number } | null) => {
    if (!dictationBridge || typeof dictationBridge.updateIndicator !== 'function') {
      return
    }
    try {
      void dictationBridge.updateIndicator({ visible, mode, position })
    } catch (error) {
      log('debug', 'dictation desktop indicator update failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }, [dictationBridge, log])

  const fetchIndicatorPosition = useCallback(async () => {
    if (!dictationBridge || typeof dictationBridge.getFocusBounds !== 'function') {
      return null
    }
    try {
      const result = await dictationBridge.getFocusBounds()
      if (
        result &&
        typeof result.x === 'number' &&
        typeof result.y === 'number' &&
        Number.isFinite(result.x) &&
        Number.isFinite(result.y)
      ) {
        return { x: result.x, y: result.y }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('debug', 'dictation indicator position fetch failed', { error: message })
    }
    return null
  }, [dictationBridge, log])

  const requestAutoPaste = useCallback((text: string) => {
    if (!text) {
      return
    }
    if (!dictationBridge || typeof dictationBridge.typeText !== 'function') {
      log('debug', 'dictation auto paste skipped – bridge unavailable')
      return
    }

    const invokePaste = (position: { x: number; y: number } | null) => {
      updateDesktopIndicator(true, 'processing', position)
      log('debug', 'dictation auto paste requested', { length: text.length })
      void dictationBridge
        .typeText({ text, mode: 'paste' })
        .then(result => {
          const ok = Boolean(result?.ok)
          log(ok ? 'debug' : 'warn', 'dictation auto paste result', {
            ok,
            method: result?.method ?? null,
          })
          if (ok) {
            updateDesktopIndicator(false, 'recording', null)
          }
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error)
          log('error', 'dictation auto paste failed', { error: message })
          updateDesktopIndicator(false, 'recording', null)
        })
        .finally(() => {
          updateDesktopIndicator(false, 'recording', null)
        })
    }

    void fetchIndicatorPosition().then(position => {
      invokePaste(position)
    })
  }, [dictationBridge, log, updateDesktopIndicator, fetchIndicatorPosition])

  const requestIndicatorPosition = useCallback((mode: 'recording' | 'processing') => {
    const now = Date.now()
    if (now - lastIndicatorFetchRef.current < 250) {
      return
    }
    lastIndicatorFetchRef.current = now
    void fetchIndicatorPosition().then(position => {
      if (position) {
        setState(prev => {
          const current = prev.indicatorPosition
          if (current && current.x === position.x && current.y === position.y) {
            return prev
          }
          return { ...prev, indicatorPosition: position }
        })
      } else {
        setState(prev => (prev.indicatorPosition === null ? prev : { ...prev, indicatorPosition: null }))
      }
      updateDesktopIndicator(true, mode, position)
    })
  }, [fetchIndicatorPosition, updateDesktopIndicator])

  const clearWatchdogTimer = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      window.clearTimeout(watchdogTimerRef.current)
      watchdogTimerRef.current = null
    }
  }, [])

  const cancelActiveUpload = useCallback(() => {
    if (activeUploadAbortRef.current) {
      try {
        activeUploadAbortRef.current.abort()
      } catch (error) {
        log('warn', 'failed to abort active upload', { error })
      }
      activeUploadAbortRef.current = null
    }
  }, [log])

  const dismissNotification = useCallback((id: string) => {
    const timer = notificationTimersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      notificationTimersRef.current.delete(id)
    }
    setNotifications(prev => prev.filter(notification => notification.id !== id))
  }, [])

  const clearNotifications = useCallback(() => {
    notificationTimersRef.current.forEach(timer => window.clearTimeout(timer))
    notificationTimersRef.current.clear()
    setNotifications([])
  }, [])

  const pushNotification = useCallback((notification: Omit<DictationNotification, 'id'> & { id?: string }) => {
    const id = notification.id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `dict-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

    setNotifications(prev => {
      const next = prev.filter(existing => existing.id !== id)
      next.push({ ...notification, id })
      return next
    })

    if (notification.autoCloseMs && notification.autoCloseMs > 0) {
      const timer = window.setTimeout(() => {
        notificationTimersRef.current.delete(id)
        dismissNotification(id)
      }, notification.autoCloseMs)
      notificationTimersRef.current.set(id, timer)
    }

    return id
  }, [dismissNotification])

  const resetSafeModeState = useCallback(() => {
    fatalErrorRef.current = { count: 0, lastErrorId: null }
    setSafeMode({ engaged: false, reason: null, fatalErrorCount: 0, lastErrorId: null, detail: null })
  }, [])

  const enterSafeMode = useCallback((reason: string, detail: string) => {
    const errorId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `safe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    const fatalCount = fatalErrorRef.current.count
    fatalErrorRef.current.lastErrorId = errorId
    setSafeMode({ engaged: true, reason, fatalErrorCount: fatalCount, lastErrorId: errorId, detail })

    pushNotification({
      severity: 'error',
      title: 'Dictation disabled',
      message: `We detected repeated failures (“${detail}”) and paused press-and-hold dictation. Resolve the issue, then re-enable it below.`,
    })

    try {
      dictationBridge?.cancelActivePress?.({
        reason: 'safe_mode_engaged',
        details: { fatalCount, errorId, cause: reason, detail },
      })
    } catch (bridgeError) {
      log('warn', 'failed to notify main process about safe mode engagement', { error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError) })
    }

    if (dictationBridge?.updateSettings) {
      dictationBridge.updateSettings({ enabled: false }).catch((error: unknown) => {
        log('warn', 'failed to persist safe mode disable flag', { error })
      })
    }
  }, [dictationBridge, log, pushNotification])

  const registerFatalError = useCallback((reason: string, message: string, options: { countsTowardSafeMode?: boolean } = {}) => {
    const { countsTowardSafeMode = true } = options
    log('warn', 'dictation fatal observation', { reason, message, countsTowardSafeMode })
    if (!countsTowardSafeMode) {
      return
    }

    fatalErrorRef.current.count += 1
    const fatalCount = fatalErrorRef.current.count

    if (fatalCount >= 3 && !safeMode.engaged) {
      enterSafeMode(reason, message)
    }
  }, [enterSafeMode, log, safeMode.engaged])

  const exitSafeMode = useCallback(async () => {
    if (!safeMode.engaged) {
      return
    }

    try {
      if (safeMode.reason === 'media_devices_unavailable' || safeMode.reason === 'recorder_init_failed') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          pushNotification({
            severity: 'error',
            title: 'Cannot re-enable dictation yet',
            message: 'Your system still lacks microphone access support.',
          })
          return
        }
        try {
          const probe = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
          probe.getTracks().forEach(track => track.stop())
        } catch (probeError) {
          pushNotification({
            severity: 'error',
            title: 'Cannot re-enable dictation yet',
            message: 'Microphone is still unavailable. Update system permissions and try again.',
          })
          return
        }
      }

      if (dictationBridge?.updateSettings) {
        await dictationBridge.updateSettings({ enabled: true })
        if (typeof dictationBridge.getSettings === 'function') {
          const latest = await dictationBridge.getSettings()
          if (!latest || latest.enabled !== true) {
            throw new Error('dictation_not_enabled')
          }
        }
      } else {
        throw new Error('missing_dictation_bridge')
      }
      resetSafeModeState()
      pushNotification({
        severity: 'info',
        title: 'Dictation re-enabled',
        message: 'Press-and-hold dictation has been reactivated.',
        autoCloseMs: 4000,
      })
    } catch (error) {
      log('error', 'failed to exit safe mode', { error })
      pushNotification({
        severity: 'error',
        title: 'Failed to re-enable dictation',
        message: 'We could not re-enable the feature. Check your connection and try again.',
      })
    }
  }, [dictationBridge, log, pushNotification, resetSafeModeState, safeMode.engaged, safeMode.reason])

  const resetRecordingState = useCallback(() => {
    clearWatchdogTimer()
    bufferedChunksRef.current = []
    mediaRecorderRef.current = null
    mediaStreamRef.current = null
    recorderMimeTypeRef.current = null
    pendingSnippetRef.current = null
    cancelActiveUpload()
    pendingPressRef.current = null
    waitingForPermissionRef.current = false
    recordingStartInFlightRef.current = false
    setState(prev => ({ ...prev, permission: null }))
  }, [cancelActiveUpload, clearWatchdogTimer])

  const stopStreamTracks = useCallback(() => {
    if (!mediaStreamRef.current) return
    mediaStreamRef.current.getTracks().forEach(track => {
      try {
        track.stop()
      } catch (error) {
        log('error', 'failed to stop media track', { error })
      }
    })
  }, [log])

  const selectSupportedMimeType = useCallback((): string | undefined => {
    const recorderCtor = window.MediaRecorder
    if (!recorderCtor || !recorderCtor.isTypeSupported) return undefined
    return RECORDER_MIME_TYPES.find(mime => recorderCtor.isTypeSupported(mime))
  }, [])

  const startRecordingSession = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('error', 'media devices API unavailable')
      setState(prev => ({ ...prev, status: 'error', error: 'microphone access unsupported' }))
      pushNotification({
        severity: 'error',
        title: 'Microphone unavailable',
        message: 'Your system does not expose the microphone API required for dictation.',
      })
      registerFatalError('media_devices_unavailable', 'Microphone access unsupported on this device.', { countsTowardSafeMode: true })
      return null
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
      mediaStreamRef.current = stream
    } catch (error) {
      log('error', 'failed to acquire microphone stream', { error })
      setState(prev => ({ ...prev, status: 'error', error: 'microphone permission denied' }))
      stopStreamTracks()
      resetRecordingState()
      pushNotification({
        severity: 'warning',
        title: 'Microphone permission denied',
        message: 'Allow microphone access to use press-and-hold dictation.',
      })
      return null
    }

    const mimeType = selectSupportedMimeType()

    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current!, mimeType ? { mimeType } : undefined)
      recorderMimeTypeRef.current = mediaRecorderRef.current.mimeType || mimeType || null
      setState(prev => ({ ...prev, error: null }))
      log('debug', 'microphone session initialized', { mimeType: mimeType || 'auto' })
      return mediaRecorderRef.current
    } catch (error) {
      log('error', 'failed to initialize MediaRecorder', { error })
      stopStreamTracks()
      resetRecordingState()
      setState(prev => ({ ...prev, status: 'error', error: 'failed to initialize recorder' }))
      pushNotification({
        severity: 'error',
        title: 'Recorder initialization failed',
        message: 'We could not start recording audio. Try again or restart the app.',
      })
      registerFatalError('recorder_init_failed', 'Failed to initialize the audio recorder.', { countsTowardSafeMode: true })
      return null
    }
  }, [log, pushNotification, registerFatalError, resetRecordingState, selectSupportedMimeType, stopStreamTracks])

  const stopRecorder = useCallback(
    (options?: { preserveBuffer?: boolean }) => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch (error) {
          log('error', 'failed to stop recorder', { error })
        }
      }

      clearWatchdogTimer()
      stopStreamTracks()
      mediaRecorderRef.current = null
      mediaStreamRef.current = null

      if (!options?.preserveBuffer) {
        bufferedChunksRef.current = []
        recorderMimeTypeRef.current = null
        pendingSnippetRef.current = null
        cancelActiveUpload()
      }
    },
    [cancelActiveUpload, clearWatchdogTimer, log, stopStreamTracks],
  )

  const startSnippetUpload = useCallback(
    (snippet: DictationSnippetPayload) => {
      if (!snippet) {
        return
      }

      cancelActiveUpload()

      const uploadAbort = new AbortController()
      activeUploadAbortRef.current = uploadAbort
      const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const startedAt = Date.now()
      let finalAttempt = 0

      setState(prev => ({
        ...prev,
        status: 'processing',
        processing: {
          requestId,
          attempt: 0,
          startedAt,
          lastError: null,
        },
        error: null,
      }))

      log('info', '[PHASE 5] dictation upload started', {
        requestId,
        sizeBytes: snippet.sizeBytes,
        durationMs: snippet.durationMs,
        base64Length: snippet.base64Audio.length,
      })

      void submitDictationSnippetWithRetry(
        {
          base64Audio: snippet.base64Audio,
          mimeType: snippet.mimeType,
          durationMs: snippet.durationMs,
          sizeBytes: snippet.sizeBytes,
          requestId,
          attempt: 0,
        },
        {
          externalAbortSignal: uploadAbort.signal,
          onAttempt: attempt => {
            finalAttempt = attempt
            log('debug', 'dictation upload attempt', { requestId, attempt })
            setState(prev => ({
              ...prev,
              processing: {
                requestId,
                attempt,
                startedAt,
                lastError: null,
              },
            }))
          },
        },
      )
        .then(result => {
          if (result.ok) {
            log('info', '[PHASE 5->6->7] dictation upload succeeded', {
              requestId,
              transcriptLength: result.transcript?.length ?? 0,
              transcript: result.transcript,
            })
            const transcript = result.transcript ?? ''
            if (!dictationDebugInstructionsLogged) {
              dictationDebugInstructionsLogged = true
              log('info', 'dictation debug tips', {
                steps: [
                  'Open DevTools console to see "dictation transcript received"',
                  'Check desktop log for "typeText requested" to compare strings',
                  'Set TRANSCRIPTAI_DICTATION_USE_CLIPBOARD=1 to test clipboard fallback',
                ],
              })
            }
            log('debug', 'dictation transcript received', { transcript })
            const expectedTarget = releaseTargetRef.current ?? null
            
            // Guard against duplicate processing of the same transcript
            if (lastInsertedTranscriptRef.current === transcript) {
              log('warn', 'dictation transcript already processed, skipping duplicate', { transcript })
              return
            }
            
            void insertDictationText(transcript, {
              expectedTarget,
              allowBridge: false,
              allowClipboard: false,
            }).then(outcome => {
              log('debug', 'dictation text inserted', outcome)
              // If insertion succeeded, mark as processed and do not call fallback
              if (outcome.ok) {
                lastInsertedTranscriptRef.current = transcript
                log('debug', 'dictation text insertion succeeded, skipping fallback', { method: outcome.method })
                return
              }
              // Only use fallback for specific failure reasons where no insertion occurred
              if (outcome.reason === 'target_mismatch') {
                log('info', 'dictation insertion skipped – target changed before insert, using fallback')
                lastInsertedTranscriptRef.current = transcript
                requestAutoPaste(transcript)
              } else if (outcome.reason === 'no_target') {
                log('info', 'dictation insertion skipped – no target available, using fallback')
                lastInsertedTranscriptRef.current = transcript
                requestAutoPaste(transcript)
              } else {
                // For other failure reasons (bridge_failed, clipboard_failed), do not retry
                // as these indicate the fallback methods also failed
                log('debug', 'dictation auto paste skipped – insertion failed with non-fallback reason', { reason: outcome.reason })
              }
            })
            releaseTargetRef.current = null
            setState(prev => ({
              ...prev,
              status: 'idle',
              transcript: transcript || prev.transcript,
              confidence: typeof result.confidence === 'number' ? result.confidence : prev.confidence,
              error: null,
              processing: {
                requestId,
                attempt: finalAttempt,
                startedAt,
                lastError: null,
              },
            }))
            return
          }

          const errorMessage = result.error || 'dictation upload failed'
          log(result.retryable ? 'warn' : 'error', 'dictation upload failed', {
            requestId,
            error: errorMessage,
            status: result.status,
          })
          setState(prev => ({
            ...prev,
            status: 'error',
            error: errorMessage,
            processing: {
              requestId,
              attempt: finalAttempt,
              startedAt,
              lastError: errorMessage,
            },
          }))
          pushNotification({
            severity: 'error',
            title: 'Dictation upload failed',
            message: errorMessage,
          })
          registerFatalError('upload_failed', errorMessage, { countsTowardSafeMode: true })
        })
        .catch(error => {
          const errorMessage = error instanceof Error ? error.message : 'dictation upload failed'
          log('error', 'dictation upload exception', { requestId, error: errorMessage })
          setState(prev => ({
            ...prev,
            status: 'error',
            error: errorMessage,
            processing: {
              requestId,
              attempt: finalAttempt,
              startedAt,
              lastError: errorMessage,
            },
          }))
          pushNotification({
            severity: 'error',
            title: 'Dictation upload failed',
            message: errorMessage,
          })
          registerFatalError('upload_exception', errorMessage, { countsTowardSafeMode: true })
        })
        .finally(() => {
          if (activeUploadAbortRef.current === uploadAbort) {
            activeUploadAbortRef.current = null
          }
          pendingSnippetRef.current = null
        })
    },
    [cancelActiveUpload, log, pushNotification, registerFatalError],
  )

  const attemptStartRecording = useCallback(
    (origin: 'press-start' | 'permission-granted') => {
      log('debug', 'attempting to start recording', {
        origin,
        hasPendingPress: Boolean(pendingPressRef.current),
        waitingForPermission: waitingForPermissionRef.current,
        recorderState: mediaRecorderRef.current?.state || 'inactive',
      })
      if (!pendingPressRef.current) {
        log('debug', 'start recording skipped – no active press', { origin })
        return
      }
      if (waitingForPermissionRef.current) {
        log('debug', 'start recording gated by permission', { origin })
        return
      }
      if (recordingStartInFlightRef.current) {
        log('debug', 'start recording already in flight', { origin })
        return
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        log('warn', 'start recording skipped – recorder already active', { origin })
        return
      }

      recordingStartInFlightRef.current = true

      void startRecordingSession()
        .then(recorder => {
          recordingStartInFlightRef.current = false

          if (!pendingPressRef.current) {
            log('warn', 'recording start aborted – press cleared', { origin })
            stopRecorder()
            return
          }

          if (!recorder) {
            log('error', 'recorder unavailable on start attempt', { origin })
            return
          }

          bufferedChunksRef.current = []
          recorder.ondataavailable = evt => {
            if (evt.data && evt.data.size > 0) {
              bufferedChunksRef.current.push(evt.data)
              log('debug', 'recorder data chunk buffered', {
                chunkSize: evt.data.size,
                totalChunks: bufferedChunksRef.current.length,
              })
            }
          }

          recorder.onstop = () => {
            log('debug', 'media recorder stopped (onstop event)', {
              bufferedChunks: bufferedChunksRef.current.length,
            })
          }
          recorder.onerror = eventError => {
            log('error', 'recorder error', { error: eventError })
            setState(prev => ({ ...prev, status: 'error', error: 'recorder error' }))
            stopRecorder()
          }

          try {
            recorder.start()
            clearWatchdogTimer()
            watchdogTimerRef.current = window.setTimeout(() => {
              log('warn', 'recording watchdog triggered', { timeoutMs: MAX_RECORDING_DURATION_MS })
              stopRecorder()
              setState(prev => ({ ...prev, status: 'error', error: 'recording timed out' }))
              pushNotification({
                severity: 'error',
                title: 'Dictation timed out',
                message: 'Recording took too long. Release the shortcut sooner and try again.',
              })
              registerFatalError('recording_timeout', 'Recording timed out before completion.', { countsTowardSafeMode: false })
              if (window.transcriptaiDictation && typeof window.transcriptaiDictation.cancelActivePress === 'function') {
                void window.transcriptaiDictation
                  .cancelActivePress({
                    reason: 'renderer_timeout',
                    details: { source: 'watchdog' },
                  })
                  .then(response => {
                    const ok = Boolean(response && (response as { ok?: boolean }).ok)
                    log(ok ? 'debug' : 'warn', 'watchdog cancel response', {
                      ok,
                      message: (response as { message?: string })?.message,
                    })
                  })
                  .catch(cancelError => {
                    log('error', 'failed to notify cancel', { error: cancelError })
                  })
              }
            }, MAX_RECORDING_DURATION_MS)
            setState(prev => ({ ...prev, status: 'recording', error: null }))
            log('debug', 'recording started', { origin })
          } catch (error) {
            log('error', 'failed to start recorder', { error })
            setState(prev => ({ ...prev, status: 'error', error: 'failed to start recording' }))
            stopStreamTracks()
            resetRecordingState()
          }
        })
        .catch(error => {
          recordingStartInFlightRef.current = false
          log('error', 'failed to start recording session', { origin, error })
        })
    },
    [clearWatchdogTimer, log, pushNotification, registerFatalError, resetRecordingState, startRecordingSession, stopRecorder, stopStreamTracks],
  )

  const handlePermissionEvent = useCallback((event: DictationEvent) => {
    if (!event) return
    log('debug', 'renderer received dictation permission event', {
      type: event.type,
      payload: event.payload,
    })
    if (event.type === 'dictation:permission-required') {
      const payload = (event.payload ?? {}) as {
        requestId?: unknown
        accessibilityOk?: unknown
        micOk?: unknown
      }
      const requestId = typeof payload.requestId === 'number' ? payload.requestId : null
      const accessibilityOk = payload.accessibilityOk !== false
      const micOk = payload.micOk !== false
      waitingForPermissionRef.current = true
      releaseTargetRef.current = null
      setState(prev => ({
        ...prev,
        status: 'permission',
        error: null,
        permission: {
          requestId,
          accessibilityOk,
          micOk,
        },
      }))
      if (!accessibilityOk || !micOk) {
        pushNotification({
          severity: 'info',
          title: 'Microphone access required',
          message: 'Grant accessibility and microphone permissions to start dictation.',
          autoCloseMs: 6000,
        })
      }
    }
    if (event.type === 'dictation:permission-denied') {
      waitingForPermissionRef.current = false
      pendingPressRef.current = null
      releaseTargetRef.current = null
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'dictation permission denied',
        permission: null,
      }))
      pushNotification({
        severity: 'warning',
        title: 'Permission denied',
        message: 'Dictation stayed off because permissions were declined.',
      })
    }
    if (event.type === 'dictation:permission-granted') {
      waitingForPermissionRef.current = false
      if (!pendingPressRef.current) {
        log('debug', 'permission granted with no active press; returning to idle')
        setState(prev => ({ ...prev, status: 'idle', error: null, permission: null }))
        releaseTargetRef.current = null
        return
      }
      setState(prev => ({
        ...prev,
        status: 'recording',
        error: null,
        permission: null,
      }))
      attemptStartRecording('permission-granted')
    }
    if (event.type === 'dictation:permission-cleared') {
      waitingForPermissionRef.current = false
      pendingPressRef.current = null
      releaseTargetRef.current = null
      setState(prev => ({ ...prev, permission: null }))
    }
  }, [attemptStartRecording, pushNotification])

  const handleLifecycleEvent = useCallback((event: DictationEvent) => {
    if (!event) return
    log('debug', 'renderer received dictation lifecycle event', {
      type: event.type,
      payload: event.payload,
    })
    const payload = event.payload || {}
    switch (event.type) {
      case 'dictation:press-start':
        pendingPressRef.current = payload
        waitingForPermissionRef.current = true
        releaseTargetRef.current = null
        lastInsertedTranscriptRef.current = null // Clear previous transcript to allow new recording
        setState(prev => ({ ...prev, status: 'recording', error: null }))
        if (safeMode.engaged) {
          resetSafeModeState()
        }
        attemptStartRecording('press-start')
        break
      case 'dictation:press-end':
        // Guard against duplicate press-end events
        if (!mediaRecorderRef.current) {
          log('warn', 'press-end received without active recorder (already processed or not started)')
          break
        }

        releaseTargetRef.current = snapshotActiveEditable()

        setState(prev => ({ ...prev, status: 'processing', error: null }))
        waitingForPermissionRef.current = false
        pendingPressRef.current = null

        const durationMs = typeof (payload as { durationMs?: unknown }).durationMs === 'number'
          ? (payload as { durationMs: number }).durationMs
          : 0

        // FIX: Wait for recorder to flush final chunks before processing
        const recorder = mediaRecorderRef.current
        const capturedMimeType = recorderMimeTypeRef.current
        
        recorder.onstop = () => {
          // Chunks are now fully flushed - capture them
          const capturedChunks = [...bufferedChunksRef.current]
          
          log('debug', 'media recorder stopped (onstop event)', {
            bufferedChunks: bufferedChunksRef.current.length,
          })
          
          // Now clear the recorder
          stopRecorder({ preserveBuffer: false })
          
          log('debug', 'recording stopped', {
            event: 'press-end',
            chunks: capturedChunks.length,
          })

          void (async () => {
            try {
              // DIAGNOSTIC: Log chunk details before building snippet
              log('debug', '[PHASE 5 DIAGNOSTIC] Building snippet from chunks', {
                chunkCount: capturedChunks.length,
                chunkSizes: capturedChunks.map(c => (c as Blob).size),
                totalBytes: capturedChunks.reduce((sum, c) => sum + (c as Blob).size, 0),
                mimeType: capturedMimeType,
                durationMs,
              })
              
              const snippet = await buildSnippetPayload({
                chunks: capturedChunks,
                mimeType: capturedMimeType || 'audio/webm',
                durationMs,
              })
              pendingSnippetRef.current = snippet
              log('info', '[PHASE 5] snippet prepared for upload', {
                sizeBytes: snippet.sizeBytes,
                durationMs: snippet.durationMs,
                requestId: snippet.requestId,
              })
              startSnippetUpload(snippet)
            } catch (error) {
              pendingSnippetRef.current = null
              const message = error instanceof Error ? error.message : 'unknown'
              const tooLarge = typeof message === 'string' && message.includes('exceeds maximum size')
              log('error', '[PHASE 5 ERROR] failed to prepare snippet payload', { 
                error,
                chunkCount: capturedChunks.length,
                errorMessage: message,
              })
              setState(prev => ({
                ...prev,
                status: 'error',
                error: tooLarge ? 'failed to prepare audio snippet – too large' : 'failed to prepare audio snippet',
              }))
              const errorMessage = tooLarge
                ? 'Dictation snippet exceeded the maximum size. Try a shorter recording.'
                : 'We could not prepare the dictation audio snippet.'
              pushNotification({
                severity: 'error',
                title: 'Dictation preparation failed',
                message: errorMessage,
              })
              registerFatalError('snippet_prepare_failed', errorMessage, { countsTowardSafeMode: false })
            }
          })()
        }
        
        // Stop the recorder - onstop handler above will process chunks
        recorder.stop()
        break
      case 'dictation:press-cancel':
        setState(prev => ({ ...prev, status: 'idle', error: null }))
        waitingForPermissionRef.current = false
        pendingPressRef.current = null
        releaseTargetRef.current = null
        if (payload && typeof (payload as { reason?: unknown }).reason === 'string') {
          const reason = (payload as { reason: string }).reason
          if (reason === 'stuck_key_timeout') {
            pushNotification({
              severity: 'warning',
              title: 'Shortcut reset',
              message: 'We reset the dictation shortcut after detecting a stuck key.',
            })
            registerFatalError('stuck_key_timeout', 'Dictation shortcut became stuck.', { countsTowardSafeMode: false })
          }
        }
        if (!mediaRecorderRef.current && bufferedChunksRef.current.length === 0) {
          break
        }

        stopRecorder()
        log('debug', 'recording stopped', { event: 'press-cancel' })
        pendingSnippetRef.current = null
        break
      case 'dictation:permission-denied':
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'dictation permission denied',
          permission: null,
        }))
        waitingForPermissionRef.current = false
        pendingPressRef.current = null
        releaseTargetRef.current = null
        break
      case 'dictation:listener-fallback':
        setState(prev => ({ ...prev, status: 'error', error: 'dictation listener unavailable' }))
        waitingForPermissionRef.current = false
        pendingPressRef.current = null
        releaseTargetRef.current = null
        pushNotification({
          severity: 'error',
          title: 'Dictation listener unavailable',
          message: 'We lost access to the global shortcut listener. Restart TranscriptAI or re-enable permissions.',
        })
        registerFatalError('listener_failure', 'Dictation listener became unavailable.', { countsTowardSafeMode: true })
        break
      case 'dictation:stuck-key':
        pushNotification({
          severity: 'warning',
          title: 'Stuck shortcut detected',
          message: 'The dictation shortcut appeared to be held down. We reset it automatically.',
        })
        registerFatalError('stuck_key_event', 'Detected a stuck shortcut key combination.', { countsTowardSafeMode: false })
        break
      default:
        break
    }
  }, [attemptStartRecording, buildSnippetPayload, clearWatchdogTimer, log, pushNotification, registerFatalError, resetRecordingState, resetSafeModeState, safeMode.engaged, startSnippetUpload, stopRecorder])

  useEffect(() => {
    if (state.status === 'recording' || state.status === 'processing') {
      const mode = state.status === 'processing' ? 'processing' : 'recording'
      requestIndicatorPosition(mode)
      updateDesktopIndicator(true, state.status === 'processing' ? 'processing' : 'recording', state.indicatorPosition)
    } else {
      lastIndicatorFetchRef.current = 0
      setState(prev => (prev.indicatorPosition === null ? prev : { ...prev, indicatorPosition: null }))
      updateDesktopIndicator(false, 'recording', null)
    }
  }, [state.status, state.indicatorPosition, requestIndicatorPosition, updateDesktopIndicator])

  useEffect(() => {
    if (window.transcriptaiDictation) {
      permissionUnsubscribe.current = window.transcriptaiDictation.onPermissionRequired(handlePermissionEvent)
      lifecycleUnsubscribe.current = window.transcriptaiDictation.onLifecycle(handleLifecycleEvent)
    }
    return () => {
      if (permissionUnsubscribe.current) {
        try {
          permissionUnsubscribe.current()
        } catch (error) {
          console.error('[DictationController] failed to unsubscribe permission listener', error)
        }
      }
      if (lifecycleUnsubscribe.current) {
        try {
          lifecycleUnsubscribe.current()
        } catch (error) {
          console.error('[DictationController] failed to unsubscribe lifecycle listener', error)
        }
      }
      cancelActiveUpload()
    }
  }, [cancelActiveUpload, handleLifecycleEvent, handlePermissionEvent])

  useEffect(() => () => {
    notificationTimersRef.current.forEach(timer => window.clearTimeout(timer))
    notificationTimersRef.current.clear()
    updateDesktopIndicator(false, 'recording', null)
  }, [])

  return {
    ...state,
    notifications,
    safeMode,
    dismissNotification,
    clearNotifications,
    exitSafeMode,
  }
}
