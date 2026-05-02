import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button, Card } from '../components/Shared'
import { useLiveRecorder } from '../modules/live/useLiveRecorder'
import { LiveStreamClient } from '../modules/live/liveStreamClient'
import type { LiveCompleteEvent, LivePartialEvent, LiveStatus } from '../types/live'

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function statusLabel(status: LiveStatus): string {
  switch (status) {
    case 'idle': return 'Idle'
    case 'starting': return 'Starting…'
    case 'recording': return 'Recording'
    case 'stopping': return 'Stopping…'
    case 'saving': return 'Saving…'
    case 'saved': return 'Saved'
    case 'error': return 'Error'
  }
}

function statusPillClasses(status: LiveStatus): string {
  switch (status) {
    case 'recording':
      return 'bg-rose-400/15 text-rose-200 border-rose-400/40'
    case 'starting':
    case 'stopping':
    case 'saving':
      return 'bg-amber-400/10 text-amber-200 border-amber-400/30'
    case 'saved':
      return 'bg-emerald-400/10 text-emerald-200 border-emerald-400/30'
    case 'error':
      return 'bg-rose-400/10 text-rose-200 border-rose-400/30'
    default:
      return 'bg-white/5 text-white/60 border-white/15'
  }
}

const LiveMode: React.FC = () => {
  const [partials, setPartials] = useState<LivePartialEvent[]>([])
  const [completeEvent, setCompleteEvent] = useState<LiveCompleteEvent | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const streamClientRef = useRef<LiveStreamClient | null>(null)

  const recorder = useLiveRecorder({
    onError: (msg) => setStreamError(msg),
  })

  // Auto-scroll the transcript pane as new partials arrive.
  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [partials])

  // Subscribe to SSE whenever a session starts; tear it down when it ends.
  useEffect(() => {
    if (!recorder.sessionId) return
    const client = new LiveStreamClient()
    streamClientRef.current = client
    setPartials([])
    setCompleteEvent(null)
    setStreamError(null)

    client.connect(recorder.sessionId, {
      onPartial: (evt) => {
        if (!evt.text) return
        setPartials(prev => {
          const next = [...prev]
          next[evt.chunk_index] = evt
          return next
        })
      },
      onComplete: (evt) => {
        setCompleteEvent(evt)
      },
      onError: () => {
        setStreamError('Live transcript connection lost — final transcript will still save on stop.')
      },
    })

    return () => {
      client.disconnect()
      if (streamClientRef.current === client) streamClientRef.current = null
    }
  }, [recorder.sessionId])

  // Compose the transcript text from partials in order of chunk_index.
  const transcriptText = useMemo(() => {
    return partials
      .filter(Boolean)
      .map(p => p.text.trim())
      .filter(Boolean)
      .join(' ')
  }, [partials])

  const handleStart = useCallback(() => {
    setStreamError(null)
    setPartials([])
    setCompleteEvent(null)
    void recorder.start()
  }, [recorder])

  const handleStop = useCallback(() => {
    void recorder.stop()
  }, [recorder])

  const handleViewInTranscripts = useCallback(() => {
    window.dispatchEvent(new CustomEvent('transcriptai:navigate', {
      detail: { page: 'transcripts' },
    }))
  }, [])

  const handleNewSession = useCallback(() => {
    setPartials([])
    setCompleteEvent(null)
    setStreamError(null)
    recorder.reset()
  }, [recorder])

  const isRecording = recorder.status === 'recording'
  const isBusy = recorder.status === 'starting' || recorder.status === 'stopping' || recorder.status === 'saving'
  const showSavedBanner = recorder.status === 'saved' && completeEvent && (recorder.callId || completeEvent.call_id)

  return (
    <div className="space-y-6">
      <Card
        title="Live Mode"
        subtitle="Speak — your words appear here in near real-time, then save to Transcripts on stop."
        icon="🟢"
      >
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={isRecording ? handleStop : handleStart}
                disabled={isBusy}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                className={`relative flex h-32 w-32 items-center justify-center rounded-full border-2 text-white shadow-glow-pink transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 ${
                  isRecording
                    ? 'border-rose-400/60 bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 animate-mic-ripple'
                    : 'border-pink-500/50 bg-gradient-to-br from-pink-500 via-red-500 to-orange-500'
                }`}
              >
                <span className="absolute inset-3 rounded-full bg-slate-950/60" aria-hidden />
                <span className="relative z-10 text-3xl">{isRecording ? '■' : '●'}</span>
                <span className="sr-only">{isRecording ? 'Stop' : 'Record'}</span>
              </button>
              <div>
                <div className="text-sm uppercase tracking-[0.3em] text-white/50">Status</div>
                <div className={`mt-1 inline-flex items-center rounded-full border px-3 py-1 text-xs ${statusPillClasses(recorder.status)}`}>
                  <span className={`mr-2 h-2 w-2 rounded-full ${isRecording ? 'bg-rose-400 animate-pulse' : 'bg-white/40'}`} />
                  {statusLabel(recorder.status)}
                </div>
                <div className="mt-2 font-mono text-2xl text-white/90">{formatDuration(recorder.durationMs)}</div>
              </div>
            </div>
            {recorder.sessionId && (
              <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">
                Session · {recorder.sessionId.slice(0, 8)}
              </span>
            )}
          </div>

          {(streamError || recorder.error) && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              {streamError || recorder.error}
            </div>
          )}

          {showSavedBanner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100"
            >
              <span>Transcript saved to Transcripts.</span>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={handleViewInTranscripts}>
                  View in Transcripts
                </Button>
                <Button variant="secondary" size="sm" onClick={handleNewSession}>
                  New session
                </Button>
              </div>
            </motion.div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.3em] text-white/50">Live transcript</div>
              <div className="text-xs text-white/40">{partials.filter(Boolean).length} chunks</div>
            </div>
            <div
              ref={transcriptRef}
              className="min-h-[220px] max-h-[420px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm leading-relaxed text-white/90"
            >
              {transcriptText ? (
                <p className="whitespace-pre-wrap">{transcriptText}</p>
              ) : (
                <p className="text-white/40">
                  {isRecording
                    ? 'Listening… your words will appear here within a few seconds.'
                    : 'Press the record button to begin a live transcription session.'}
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-white/40">
              Tip: the live transcript is approximate. The final, saved transcript on the Transcripts page is the canonical version.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default LiveMode
