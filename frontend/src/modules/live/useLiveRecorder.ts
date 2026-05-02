import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/services/api/client'
import type { LiveRecorderApi, LiveStatus } from '@/types/live'

const CHUNK_TIMESLICE_MS = 4000
const STOP_FLUSH_DELAY_MS = 1200
const STOP_UPLOAD_TIMEOUT_MS = 5000

export interface UseLiveRecorderOptions {
  onStart?: (sessionId: string) => void
  onStop?: (result: { callId: string | null; finalText: string }) => void
  onError?: (message: string) => void
}

export function useLiveRecorder(options: UseLiveRecorderOptions = {}): LiveRecorderApi {
  const { onStart, onStop, onError } = options

  const [status, setStatus] = useState<LiveStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)

  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingUploadsRef = useRef(0)
  const uploadsSettledResolveRef = useRef<null | (() => void)>(null)
  const uploadsSettledPromiseRef = useRef<Promise<void> | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const tickHandleRef = useRef<number | null>(null)

  // Tick the duration while recording so the page can show 0:01, 0:02, …
  useEffect(() => {
    if (status !== 'recording') {
      if (tickHandleRef.current !== null) {
        window.clearInterval(tickHandleRef.current)
        tickHandleRef.current = null
      }
      return
    }
    recordingStartedAtRef.current = Date.now()
    tickHandleRef.current = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current
      if (startedAt) setDurationMs(Date.now() - startedAt)
    }, 250)
    return () => {
      if (tickHandleRef.current !== null) {
        window.clearInterval(tickHandleRef.current)
        tickHandleRef.current = null
      }
    }
  }, [status])

  // Cleanup on unmount: stop tracks and recorder, best-effort
  useEffect(() => {
    return () => {
      try { mediaRef.current?.stop() } catch { /* noop */ }
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* noop */ }
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setSessionId(null)
    setCallId(null)
    setError(null)
    setDurationMs(0)
    sessionIdRef.current = null
    pendingUploadsRef.current = 0
    uploadsSettledResolveRef.current = null
    uploadsSettledPromiseRef.current = null
    recordingStartedAtRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'starting') return
    setError(null)
    setCallId(null)
    setDurationMs(0)
    setStatus('starting')

    try {
      const res = await apiClient.post('/api/v1/live/start')
      const sid = res.data?.session_id as string | undefined
      if (!sid) throw new Error('Failed to create session')
      sessionIdRef.current = sid
      setSessionId(sid)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const preferredMime = 'audio/webm;codecs=opus'
      const mimeSupported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferredMime)
      const mr = mimeSupported
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream)
      mediaRef.current = mr

      mr.ondataavailable = async (ev: BlobEvent) => {
        const s = sessionIdRef.current
        if (!s) return
        const blob = ev.data
        if (!blob || blob.size === 0) return

        const fd = new FormData()
        const extension = blob.type === 'audio/mp4' ? 'm4a' : 'webm'
        const file = new File([blob], `chunk_${Date.now()}.${extension}`, { type: blob.type })
        fd.append('file', file)

        if (!uploadsSettledPromiseRef.current) {
          uploadsSettledPromiseRef.current = new Promise<void>(resolve => {
            uploadsSettledResolveRef.current = resolve
          })
        }
        pendingUploadsRef.current += 1
        try {
          await apiClient.post(`/api/v1/live/chunk?session_id=${encodeURIComponent(s)}`, fd)
        } catch (err) {
          console.warn('[useLiveRecorder] chunk upload failed', err)
        } finally {
          pendingUploadsRef.current -= 1
          if (pendingUploadsRef.current <= 0 && uploadsSettledResolveRef.current) {
            uploadsSettledResolveRef.current()
            uploadsSettledResolveRef.current = null
            uploadsSettledPromiseRef.current = null
          }
        }
      }

      mr.start(CHUNK_TIMESLICE_MS)
      setStatus('recording')
      onStart?.(sid)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start recording'
      setError(msg)
      setStatus('error')
      try { mediaRef.current?.stop() } catch { /* noop */ }
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* noop */ }
      sessionIdRef.current = null
      setSessionId(null)
      onError?.(msg)
    }
  }, [status, onStart, onError])

  const stop = useCallback(async (): Promise<{ callId: string | null; finalText: string } | null> => {
    if (status !== 'recording' && status !== 'starting') return null
    setStatus('stopping')

    try {
      try { mediaRef.current?.requestData?.() } catch { /* noop */ }
      try { mediaRef.current?.stop() } catch { /* noop */ }
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* noop */ }
    } catch { /* noop */ }

    setStatus('saving')

    try {
      // Wait for the final dataavailable to fire, then for in-flight uploads to settle.
      await new Promise(resolve => setTimeout(resolve, STOP_FLUSH_DELAY_MS))
      if (pendingUploadsRef.current > 0) {
        const settle = uploadsSettledPromiseRef.current
        await Promise.race([
          settle ?? Promise.resolve(),
          new Promise(resolve => setTimeout(resolve, STOP_UPLOAD_TIMEOUT_MS)),
        ])
      }

      const sid = sessionIdRef.current
      if (!sid) {
        const msg = 'Session not found'
        setError(msg)
        setStatus('error')
        onError?.(msg)
        return null
      }

      const res = await apiClient.post(
        `/api/v1/live/stop?session_id=${encodeURIComponent(sid)}`,
        undefined,
        { timeout: 0 },
      )
      const finalText = (res.data?.final_text as string) || ''
      const cid = (res.data?.call_id as string) || null

      sessionIdRef.current = null
      setSessionId(null)
      setCallId(cid)
      setStatus('saved')
      onStop?.({ callId: cid, finalText })
      return { callId: cid, finalText }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to finalize transcript'
      setError(msg)
      setStatus('error')
      sessionIdRef.current = null
      setSessionId(null)
      onError?.(msg)
      return null
    }
  }, [status, onStop, onError])

  return {
    status,
    sessionId,
    callId,
    error,
    durationMs,
    start,
    stop,
    reset,
  }
}
