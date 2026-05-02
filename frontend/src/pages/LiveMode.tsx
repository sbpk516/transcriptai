import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { apiClient } from '@/services/api/client'
import { Button, Card } from '../components/Shared'
import { useLiveRecorder } from '../modules/live/useLiveRecorder'
import { LiveStreamClient } from '../modules/live/liveStreamClient'
import { useSentenceRephraser } from '../modules/live/useSentenceRephraser'
import { ProviderPicker } from '../modules/live/ProviderPicker'
import { buildGistMessages } from '../modules/live/rephrasePrompt'
import type { LiveCompleteEvent, LivePartialEvent, LiveStatus } from '../types/live'
import type { ProviderId } from '../types/byok'
import type { SentenceState } from '../types/rephrase'

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

function describeRephraseError(code?: string): string {
  switch (code) {
    case 'no_key': return 'no key saved'
    case 'invalid': return 'key rejected'
    case 'rate_limited': return 'rate limited'
    case 'timeout': return 'timed out'
    case 'out_of_credits': return 'no credits'
    case 'network_error': return 'network error'
    case 'model_not_found': return 'model unavailable'
    case 'bridge_unavailable': return 'LLM bridge unavailable'
    default: return 'rephrase failed'
  }
}

function PolishedCell({ sentence }: { sentence: SentenceState }) {
  if (sentence.status === 'polishing' || sentence.status === 'pending') {
    return <span className="animate-pulse text-white/40">polishing…</span>
  }
  if (sentence.status === 'error') {
    return (
      <span className="text-white/80">
        {sentence.polished || sentence.raw}
        <span className="ml-1 text-xs text-rose-300/80">({describeRephraseError(sentence.errorCode)})</span>
      </span>
    )
  }
  if (sentence.status === 'skipped') {
    return <span className="text-white/70">{sentence.polished || sentence.raw}</span>
  }
  return <span className="text-white/90">{sentence.polished || sentence.raw}</span>
}

type TranscriptTab = 'raw' | 'polished' | 'gist'

interface TranscriptPaneProps {
  sentences: SentenceState[]
  isRecording: boolean
  provider: ProviderId | null
  scrollRef: React.RefObject<HTMLDivElement>
  transcriptText: string
  gist: GistState
  onRunGist: () => void
}

function TranscriptPane({
  sentences,
  isRecording,
  provider,
  scrollRef,
  transcriptText,
  gist,
  onRunGist,
}: TranscriptPaneProps) {
  const [tab, setTab] = useState<TranscriptTab>('polished')

  const polishingCount = sentences.filter(s => s.status === 'polishing' || s.status === 'pending').length
  const errorCount = sentences.filter(s => s.status === 'error').length

  const empty = sentences.length === 0
  const hasProvider = provider !== null
  const hasTranscript = transcriptText.trim().length > 0

  // When user switches to the Gist tab, fire a fresh summary if there's any new
  // transcript text since the last gist (or no gist yet).
  const handleSwitchTab = useCallback(
    (next: TranscriptTab) => {
      setTab(next)
      if (next !== 'gist') return
      if (!hasProvider || !hasTranscript) return
      if (gist.status === 'summarizing') return
      // Only auto-fire if the gist is stale or hasn't been computed yet.
      if (gist.basedOnTranscript === transcriptText.trim()) return
      onRunGist()
    },
    [gist.status, gist.basedOnTranscript, transcriptText, hasProvider, hasTranscript, onRunGist],
  )

  const isGistStale = tab === 'gist'
    && gist.status === 'done'
    && gist.basedOnTranscript !== transcriptText.trim()

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1 text-sm">
          <button
            type="button"
            onClick={() => handleSwitchTab('raw')}
            className={`flex items-center gap-2 rounded-xl px-4 py-1.5 transition ${
              tab === 'raw'
                ? 'bg-white/15 text-white shadow-glow-sm'
                : 'text-white/60 hover:text-white/80'
            }`}
          >
            <span aria-hidden>📝</span>
            Raw
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('polished')}
            className={`flex items-center gap-2 rounded-xl px-4 py-1.5 transition ${
              tab === 'polished'
                ? 'bg-cyan-400/20 text-cyan-100 shadow-glow-sm'
                : 'text-white/60 hover:text-white/80'
            }`}
          >
            <span aria-hidden>✨</span>
            Polished
            {polishingCount > 0 && (
              <span className="ml-1 inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            )}
            {errorCount > 0 && (
              <span className="ml-1 rounded-full bg-rose-400/20 px-1.5 text-[10px] text-rose-200">
                {errorCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('gist')}
            className={`flex items-center gap-2 rounded-xl px-4 py-1.5 transition ${
              tab === 'gist'
                ? 'bg-amber-400/20 text-amber-100 shadow-glow-sm'
                : 'text-white/60 hover:text-white/80'
            }`}
          >
            <span aria-hidden>💡</span>
            Gist
            {gist.status === 'summarizing' && (
              <span className="ml-1 inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          {tab === 'raw' && <span>Original whisper transcript</span>}
          {tab === 'polished' && (
            <span>{provider ? `LLM polished · ${provider}` : 'No key — polished mirrors raw'}</span>
          )}
          {tab === 'gist' && (
            <>
              <span>{provider ? `Summary · ${provider}` : 'No key saved'}</span>
              {(gist.status === 'done' || gist.status === 'error') && hasProvider && hasTranscript && (
                <button
                  type="button"
                  onClick={onRunGist}
                  className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-400/20"
                  title="Re-summarize with the latest transcript"
                >
                  ↻ Refresh
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`min-h-[260px] max-h-[480px] overflow-y-auto rounded-2xl border p-4 text-sm leading-relaxed transition ${
          tab === 'polished'
            ? 'border-cyan-400/20 bg-cyan-400/[0.03]'
            : tab === 'gist'
              ? 'border-amber-400/20 bg-amber-400/[0.03]'
              : 'border-white/10 bg-slate-950/40'
        }`}
      >
        {tab === 'raw' && (
          empty ? (
            <p className="text-white/40">
              {isRecording
                ? 'Listening… your words will appear here within a few seconds.'
                : 'Press the record button to begin a live transcription session.'}
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-white/85">
              {sentences.map(s => s.raw).join(' ')}
            </p>
          )
        )}

        {tab === 'polished' && (
          empty ? (
            <p className="text-white/40">
              {isRecording
                ? 'Listening… polished sentences will appear here.'
                : 'Press record to begin.'}
            </p>
          ) : (
            <div className="space-y-2">
              {sentences.map(s => (
                <div key={s.index} className="leading-relaxed">
                  <PolishedCell sentence={s} />
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'gist' && (
          <GistView
            gist={gist}
            isStale={isGistStale}
            hasProvider={hasProvider}
            hasTranscript={hasTranscript}
          />
        )}
      </div>
    </div>
  )
}

function GistView({
  gist,
  isStale,
  hasProvider,
  hasTranscript,
}: {
  gist: GistState
  isStale: boolean
  hasProvider: boolean
  hasTranscript: boolean
}) {
  if (!hasProvider) {
    return (
      <p className="text-white/60">
        Save an API key in Settings to enable on-demand summaries.
      </p>
    )
  }
  if (!hasTranscript) {
    return (
      <p className="text-white/40">
        Speak for a few seconds, then come back to this tab to see a summary.
      </p>
    )
  }
  if (gist.status === 'idle') {
    return (
      <p className="text-white/60">Preparing summary…</p>
    )
  }
  if (gist.status === 'summarizing') {
    return (
      <p className="animate-pulse text-amber-200/80">Summarizing what's been said so far…</p>
    )
  }
  if (gist.status === 'error') {
    return (
      <p className="text-rose-200">
        Couldn't generate a summary ({describeRephraseError(gist.errorCode)}). Hit ↻ Refresh to retry.
      </p>
    )
  }
  const timestamp = gist.updatedAt
    ? new Date(gist.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="space-y-3">
      {isStale && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-1.5 text-xs text-amber-200/80">
          New speech since this summary — hit ↻ Refresh to update.
        </p>
      )}
      <div className="whitespace-pre-wrap text-white/90">{gist.text || ''}</div>
      {timestamp && (
        <p className="text-xs text-white/40">Last summarized at {timestamp}</p>
      )}
    </div>
  )
}

type GistStatus = 'idle' | 'summarizing' | 'done' | 'error'

interface GistState {
  text: string | null
  status: GistStatus
  errorCode?: string
  basedOnTranscript: string
  updatedAt: number | null
}

const LiveMode: React.FC = () => {
  const [partials, setPartials] = useState<LivePartialEvent[]>([])
  const [completeEvent, setCompleteEvent] = useState<LiveCompleteEvent | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [persistedRephrased, setPersistedRephrased] = useState(false)
  const [gist, setGist] = useState<GistState>({ text: null, status: 'idle', basedOnTranscript: '', updatedAt: null })
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const streamClientRef = useRef<LiveStreamClient | null>(null)
  const persistInFlightRef = useRef(false)
  const gistInFlightRef = useRef(false)

  const recorder = useLiveRecorder({
    onError: (msg) => setStreamError(msg),
  })

  // Compose the raw transcript text from partials in order of chunk_index.
  const transcriptText = useMemo(() => {
    return partials
      .filter(Boolean)
      .map(p => p.text.trim())
      .filter(Boolean)
      .join(' ')
  }, [partials])

  const rephraser = useSentenceRephraser({
    transcriptText,
    provider,
    enabled: provider !== null,
  })

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [rephraser.sentences])

  useEffect(() => {
    if (!recorder.sessionId) return
    const client = new LiveStreamClient()
    streamClientRef.current = client
    setPartials([])
    setCompleteEvent(null)
    setStreamError(null)
    setPersistedRephrased(false)
    rephraser.reset()

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.sessionId])

  // After /live/stop returns a call_id, flush in-flight rephrasing and POST the polished transcript.
  useEffect(() => {
    if (recorder.status !== 'saved') return
    if (!recorder.callId) return
    if (persistInFlightRef.current || persistedRephrased) return
    persistInFlightRef.current = true
    void (async () => {
      try {
        const finalRephrased = await rephraser.flush()
        await apiClient.post(
          `/api/v1/calls/${encodeURIComponent(recorder.callId!)}/rephrased`,
          { rephrased_text: finalRephrased },
        )
        setPersistedRephrased(true)
      } catch (err) {
        console.warn('[LiveMode] persisting rephrased text failed', err)
      } finally {
        persistInFlightRef.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.status, recorder.callId])

  const runGist = useCallback(async () => {
    const bridge = (typeof window !== 'undefined' ? window.transcriptaiLlm : null) || null
    const text = transcriptText.trim()
    if (!bridge || !provider || !text) return
    if (gistInFlightRef.current) return
    gistInFlightRef.current = true
    setGist(prev => ({ ...prev, text: null, status: 'summarizing', basedOnTranscript: text }))
    try {
      const result = await bridge.complete({
        provider,
        messages: buildGistMessages(text),
        maxTokens: 400,
        temperature: 0.5,
      })
      if (result.ok) {
        setGist({
          text: (result.text || '').trim(),
          status: 'done',
          basedOnTranscript: text,
          updatedAt: Date.now(),
        })
      } else {
        setGist({
          text: null,
          status: 'error',
          errorCode: result.error,
          basedOnTranscript: text,
          updatedAt: Date.now(),
        })
      }
    } catch (err) {
      console.warn('[LiveMode] gist call failed', err)
      setGist({
        text: null,
        status: 'error',
        errorCode: 'completion_failed',
        basedOnTranscript: text,
        updatedAt: Date.now(),
      })
    } finally {
      gistInFlightRef.current = false
    }
  }, [provider, transcriptText])

  const handleStart = useCallback(() => {
    setStreamError(null)
    setPartials([])
    setCompleteEvent(null)
    setPersistedRephrased(false)
    setGist({ text: null, status: 'idle', basedOnTranscript: '', updatedAt: null })
    rephraser.reset()
    void recorder.start()
  }, [recorder, rephraser])

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
    setPersistedRephrased(false)
    setGist({ text: null, status: 'idle', basedOnTranscript: '', updatedAt: null })
    rephraser.reset()
    recorder.reset()
  }, [recorder, rephraser])

  const isRecording = recorder.status === 'recording'
  const isBusy = recorder.status === 'starting' || recorder.status === 'stopping' || recorder.status === 'saving'
  const showSavedBanner = recorder.status === 'saved' && completeEvent && (recorder.callId || completeEvent.call_id)

  const sentences = rephraser.sentences

  return (
    <div className="space-y-6">
      <Card
        title="Live Mode"
        subtitle="Speak — words appear raw on the left, polished by your chosen LLM on the right."
        icon="🟢"
      >
        <div className="space-y-6">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ProviderPicker value={provider} onChange={setProvider} />
            {recorder.sessionId && (
              <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">
                Session · {recorder.sessionId.slice(0, 8)}
              </span>
            )}
          </div>

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
              <span>
                {persistedRephrased
                  ? 'Saved (raw + polished) to Transcripts.'
                  : 'Transcript saved to Transcripts. Polishing in flight…'}
              </span>
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

          <TranscriptPane
            sentences={sentences}
            isRecording={isRecording}
            provider={provider}
            scrollRef={transcriptRef}
            transcriptText={transcriptText}
            gist={gist}
            onRunGist={runGist}
          />
          <p className="text-xs text-white/40">
            Tip: switch tabs anytime. Both versions are saved to Transcripts on Stop.
          </p>
        </div>
      </Card>
    </div>
  )
}

export default LiveMode
