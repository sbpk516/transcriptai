function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) {
    return `${secs}s`
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

function formatFileSizeReadable(bytes: number | string): string {
  if (typeof bytes !== 'number') {
    return typeof bytes === 'string' ? bytes : 'Unknown'
  }
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}
import React, { useState, useEffect } from 'react'
import { apiClient } from '@/services/api/client'
import { deleteResult, clearAllResults, exportTranscript, ExportFormat } from '@/services/api/results'
import { formatTranscript } from '@/utils/transcript'
import { useTranscriptionStream } from '@/services/api/live'
import { Button, Card } from '../components/Shared'

// STEP 2: Add basic API integration
// We'll add API call to fetch transcripts from backend

const Transcripts: React.FC = () => {
  // STEP 2: Add state for API transcripts
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  // Detail view (lazy-loaded per call)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
  const [detailsCache, setDetailsCache] = useState<Record<string, any>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null)
  const [reanalyzeErrors, setReanalyzeErrors] = useState<Record<string, string>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({})
  const [clearing, setClearing] = useState<boolean>(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const [formattingOn, setFormattingOn] = useState<boolean>(true)
  const [sentencesPerParagraph, setSentencesPerParagraph] = useState<number>(3)
  const [copied, setCopied] = useState<boolean>(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // Sort toggle (newest/oldest)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  console.log('[TRANSCRIPTS] Component rendering - Step 2 with API integration')

  // STEP 2: Add API call function
  const fetchResults = async () => {
    try {
      console.log('[TRANSCRIPTS] 🚀 Starting API call to fetch transcripts')
      setLoading(true)
      setError(null)

      // Call the backend API endpoint using shared API client (respects base URL)
      const params = new URLSearchParams()
      params.append('sort', 'created_at')
      params.append('direction', sortDirection)
      const url = `/api/v1/pipeline/results?${params.toString()}`
      console.log('[TRANSCRIPTS] 🔎 Fetch URL:', url)
      const { data } = await apiClient.get(url)
      console.log('[TRANSCRIPTS] 📥 API Response received:', data)

      // Extract results from response
      const resultsData = data.data?.results || []
      setResults(resultsData)
      console.log('[TRANSCRIPTS] ✅ Transcripts loaded:', resultsData.length, 'items')
      console.log('[TRANSCRIPTS] 📊 Full response structure:', data)
      if (resultsData.length > 0) {
        const first = resultsData[0]?.created_at || null
        const last = resultsData[resultsData.length - 1]?.created_at || null
        console.log('[TRANSCRIPTS] 🧭 Order check (created_at):', { direction: sortDirection, first, last })
      }

    } catch (err) {
      console.error('[TRANSCRIPTS] ❌ API call failed:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch transcripts'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const fetchResultDetail = async (callId: string) => {
    try {
      setDetailLoadingId(callId)
      const { data } = await apiClient.get(`/api/v1/pipeline/results/${callId}`)
      const detail = data?.data || null
      setDetailsCache(prev => ({ ...prev, [callId]: detail }))
      setDetailErrors(prev => ({ ...prev, [callId]: '' }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch details'
      setDetailErrors(prev => ({ ...prev, [callId]: msg }))
    } finally {
      setDetailLoadingId(null)
    }
  }

  const onToggleDetails = (callId: string) => {
    if (expandedId === callId) {
      setExpandedId(null)
      return
    }
    setExpandedId(callId)
    if (!detailsCache[callId] && detailLoadingId !== callId) {
      fetchResultDetail(callId)
    }
  }

  const reanalyzeCall = async (callId: string) => {
    try {
      setReanalyzingId(callId)
      setReanalyzeErrors(prev => ({ ...prev, [callId]: '' }))
      await apiClient.post(`/api/v1/pipeline/reanalyze/${callId}`)
      await fetchResultDetail(callId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reanalyze call'
      setReanalyzeErrors(prev => ({ ...prev, [callId]: msg }))
    } finally {
      setReanalyzingId(null)
    }
  }

  // Load transcripts when component mounts and when sort changes
  useEffect(() => {
    console.log('[TRANSCRIPTS] 🔄 Fetching transcripts with sort direction:', sortDirection)
    fetchResults()
  }, [sortDirection])

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Filter results based on search
  const filteredResults = results.filter(r => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    const filename = (r.file_info?.original_filename || r.call_id).toLowerCase()
    // We can also search cached transcript text if available, but for now filename + status is good
    return filename.includes(query) || r.status.toLowerCase().includes(query)
  })

  const transcriptCount = filteredResults.length

  return (
    <div className="space-y-8">
      <section className="glass-surface rounded-3xl border border-white/10 px-6 py-8 shadow-glow md:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-white/60">Transcripts</p>
            <h1 className="gradient-heading mt-3 text-4xl font-semibold leading-tight">
              Transcript history
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/70">
              Review capture history, live-stream status, and AI summaries inside modern cards with subtle glows.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* Global Actions */}
            <Button variant="ghost" size="sm" onClick={fetchResults} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={loading || clearing}
              onClick={async () => {
                if (!confirm('Delete ALL transcripts and uploaded artifacts?')) return
                try {
                  setClearing(true)
                  setClearError(null)
                  await clearAllResults()
                  setResults([])
                  setExpandedId(null)
                  setDetailsCache({})
                  setDetailErrors({})
                  setReanalyzeErrors({})
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Failed to clear transcripts'
                  setClearError(msg)
                } finally {
                  setClearing(false)
                }
              }}
            >
              {clearing ? 'Deleting…' : 'Clear All'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  localStorage.clear()
                } catch (e) {
                  console.warn('[TRANSCRIPTS] Failed to clear localStorage', e)
                }
              }}
            >
              Clear Local Cache
            </Button>
          </div>
        </div>

        {/* Search Bar - Matches User Design */}
        <div className="mt-8 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-white/40">🔍</span>
          </div>
          <input
            type="text"
            placeholder="Search transcripts, files, or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/20 pl-10 pr-4 py-3 text-sm text-white placeholder-white/30 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-all backdrop-blur-sm"
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3 text-center text-xs uppercase tracking-[0.3em] text-white/70">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold text-white">{results.length}</p>
            <p>Total</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold text-emerald-300">
              {results.filter(r => r.status === 'completed').length}
            </p>
            <p>Completed</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold text-pink-300">
              {results.filter(r => r.status !== 'completed').length}
            </p>
            <p>In Flight</p>
          </div>
        </div>
      </section>
      {loading && (
        <div className="glass-surface rounded-3xl border border-white/10 px-6 py-10 text-center text-white/80 shadow-glow">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-cyan-400" />
          <p className="mt-4 text-sm">Loading transcripts from the backend…</p>
        </div>
      )}

      {error && (
        <div className="glass-surface rounded-2xl border border-rose-500/30 px-5 py-4 text-sm text-rose-100 shadow-glow-pink">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-semibold">API Error</p>
              <p className="text-white/70">{error}</p>
            </div>
          </div>
        </div>
      )}
      {clearError && (
        <div className="glass-surface rounded-2xl border border-yellow-400/30 px-5 py-4 text-sm text-yellow-100 shadow-glow">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <p className="font-semibold">Clear Error</p>
              <p className="text-white/70">{clearError}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <Card
            title={`Transcripts (${transcriptCount})`}
            subtitle={searchQuery ? `Showing results for "${searchQuery}"` : "Capture new audio and refresh to sync the latest entries."}
            icon="📡"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-white/70">
              <p>Sort by created date</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = sortDirection === 'desc' ? 'asc' : 'desc'
                  setSortDirection(next)
                }}
              >
                {sortDirection === 'desc' ? 'Newest first' : 'Oldest first'}
              </Button>
            </div>
          </Card>

          {filteredResults.length === 0 ? (
            <Card title="No Transcripts Found" subtitle={searchQuery ? "Try adjusting your search query." : "Capture or upload audio to populate this view."} icon="📭">
              <p className="text-sm text-white/70">
                {searchQuery ? "No matches found." : "Once you complete a capture, transcripts appear here instantly."}
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredResults.map((result) => {
                const status = result.status || 'unknown'
                const statusStyles =
                  status === 'completed'
                    ? 'border-emerald-400/30 text-emerald-200'
                    : status === 'processing'
                      ? 'border-yellow-400/30 text-yellow-100'
                      : status === 'failed'
                        ? 'border-pink-500/40 text-rose-200'
                        : 'border-white/20 text-white/70'

                const fileName =
                  result.file_info?.original_filename ||
                  result.file_info?.file_path?.split('/')?.pop() ||
                  result.call_id
                const durationSeconds = typeof result.audio_analysis?.duration === 'number'
                  ? result.audio_analysis.duration
                  : null
                return (
                  <Card
                    key={result.call_id}
                    title={fileName}
                    subtitle={result.created_at ? new Date(result.created_at).toLocaleString() : 'Unknown date'}
                    className="space-y-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em]">
                        <span className={`rounded-full border px-3 py-1 ${statusStyles}`}>
                          {status}
                        </span>
                        {durationSeconds != null && (
                          <span className="rounded-full border border-white/15 px-3 py-1 text-white/70 normal-case">
                            {formatDuration(durationSeconds)}
                          </span>
                        )}
                        {result.file_info?.file_size && (
                          <span className="rounded-full border border-white/15 px-3 py-1 text-white/70 normal-case">
                            {formatFileSizeReadable(result.file_info.file_size)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">


                        {/* Secondary Action: View */}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onToggleDetails(result.call_id)}
                        >
                          {expandedId === result.call_id ? 'Hide' : '📄 View'}
                        </Button>

                        {/* Utility Action: Copy (Simulated for list view) */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Copy Transcript"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              // Optimization: If we have it in cache, copy immediately. 
                              // If not, we might need to fetch. For now, trigger fetch if needed.
                              if (!detailsCache[result.call_id]) {
                                await fetchResultDetail(result.call_id)
                              }
                              const text = detailsCache[result.call_id]?.transcription?.transcription_text
                              if (text) {
                                await navigator.clipboard.writeText(text)
                                alert("Transcript copied to clipboard!")
                              } else {
                                // Trigger expand to load if not loaded
                                onToggleDetails(result.call_id)
                              }
                            } catch (err) {
                              console.error("Copy failed", err)
                            }
                          }}
                        >
                          📋
                        </Button>

                        {/* Destructive Action: Delete */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-50 hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-200"
                          onClick={async () => {
                            if (!confirm('Delete this result permanently?')) return
                            try {
                              setDeletingId(result.call_id)
                              setDeleteErrors(prev => ({ ...prev, [result.call_id]: '' }))
                              await deleteResult(result.call_id)
                              setResults(prev => prev.filter(r => r.call_id !== result.call_id))
                            } catch (err) {
                              const msg = err instanceof Error ? err.message : 'Failed to delete result'
                              setDeleteErrors(prev => ({ ...prev, [result.call_id]: msg }))
                            } finally {
                              setDeletingId(null)
                            }
                          }}
                          disabled={deletingId === result.call_id}
                        >
                          ⋮
                        </Button>
                      </div>
                    </div>
                    {deleteErrors[result.call_id] && (
                      <p className="text-xs text-rose-300">{deleteErrors[result.call_id]}</p>
                    )}

                    {expandedId === result.call_id && (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 space-y-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <p className="text-white/60">Call ID: {result.call_id}</p>
                          <div className="flex flex-wrap gap-2 items-center">
                            {reanalyzingId === result.call_id && (
                              <span className="text-xs text-white/60">Reanalyzing…</span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reanalyzeCall(result.call_id)}
                              disabled={reanalyzingId === result.call_id}
                            >
                              Reanalyze
                            </Button>
                          </div>
                        </div>
                        {detailLoadingId === result.call_id && (
                          <p className="text-white/70">Loading details…</p>
                        )}
                        {detailErrors[result.call_id] && (
                          <p className="text-rose-300">{detailErrors[result.call_id]}</p>
                        )}
                        {reanalyzeErrors[result.call_id] && (
                          <p className="text-rose-300">{reanalyzeErrors[result.call_id]}</p>
                        )}
                        {(['processing', 'transcribing'] as const).includes(result.status as any) && (
                          <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                            <p className="font-semibold">Live Transcript (beta)</p>
                            <LiveTranscript callId={result.call_id} />
                          </div>
                        )}
                        {detailsCache[result.call_id] && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-3 text-xs text-white/70">
                              <label className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={formattingOn}
                                  onChange={(e) => setFormattingOn(e.target.checked)}
                                />
                                Neat formatting
                              </label>
                              <label className="inline-flex items-center gap-2">
                                <span>Sentences/paragraph</span>
                                <select
                                  className="rounded border border-white/20 bg-transparent px-2 py-1"
                                  value={sentencesPerParagraph}
                                  onChange={(e) =>
                                    setSentencesPerParagraph(parseInt(e.target.value) || 3)
                                  }
                                >
                                  <option value={2}>2</option>
                                  <option value={3}>3</option>
                                  <option value={4}>4</option>
                                </select>
                              </label>
                              <div className="ml-auto flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      const raw =
                                        detailsCache[result.call_id]?.transcription?.transcription_text ||
                                        ''
                                      const text = formattingOn
                                        ? (formatTranscript(raw, {
                                          sentencesPerParagraph,
                                          preserveExistingNewlines: true,
                                        }) || []
                                        ).join('\n\n')
                                        : raw
                                      if (navigator.clipboard?.writeText) {
                                        await navigator.clipboard.writeText(text)
                                      }
                                      setCopied(true)
                                      window.setTimeout(() => setCopied(false), 1500)
                                    } catch (e) {
                                      console.warn('Copy failed', e)
                                    }
                                  }}
                                >
                                  Copy
                                </Button>
                                <div className="relative">
                                  <select
                                    className="appearance-none rounded-md bg-white/10 px-3 py-1.5 pr-8 text-sm text-white/80 hover:bg-white/20 focus:outline-none focus:ring-1 focus:ring-white/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={exportingId === result.call_id}
                                    value=""
                                    onChange={async (e) => {
                                      const format = e.target.value as ExportFormat
                                      if (!format) return

                                      try {
                                        setExportingId(result.call_id)
                                        setExportError(null)

                                        const blob = await exportTranscript(result.call_id, format)

                                        // Get filename
                                        const original = detailsCache[result.call_id]?.file_info?.original_filename
                                        const fromPath = detailsCache[result.call_id]?.file_info?.file_path?.split?.('/')?.pop()
                                        const base = (original || fromPath || result.call_id).replace(/\.[^.]+$/, '')

                                        // Download the file
                                        const url = URL.createObjectURL(blob)
                                        const a = document.createElement('a')
                                        a.download = `${base}.${format}`
                                        a.href = url
                                        document.body.appendChild(a)
                                        a.click()
                                        document.body.removeChild(a)
                                        URL.revokeObjectURL(url)
                                      } catch (err) {
                                        console.error('Export failed:', err)
                                        setExportError(`Export failed. Please try again.`)
                                        setTimeout(() => setExportError(null), 4000)
                                      } finally {
                                        setExportingId(null)
                                      }
                                    }}
                                  >
                                    <option value="" disabled>
                                      {exportingId === result.call_id ? 'Exporting...' : 'Download as...'}
                                    </option>
                                    <option value="txt">TXT</option>
                                    <option value="docx">DOCX</option>
                                    <option value="pdf">PDF</option>
                                  </select>
                                  <svg
                                    className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                                {copied && (
                                  <span className="rounded-full border border-emerald-300/30 px-3 py-1 text-xs text-emerald-200">
                                    Copied!
                                  </span>
                                )}
                                {exportError && (
                                  <span className="rounded-full border border-red-400/30 px-3 py-1 text-xs text-red-300">
                                    {exportError}
                                  </span>
                                )}
                              </div>
                            </div>
                            <TranscriptBlock
                              text={detailsCache[result.call_id]?.transcription?.transcription_text || ''}
                              enabled={formattingOn}
                              sentencesPerParagraph={sentencesPerParagraph}
                            />
                            {detailsCache[result.call_id]?.nlp_analysis ? (
                              <div className="grid gap-4 md:grid-cols-3 text-sm">
                                <div>
                                  <p className="text-xs text-white/50">Sentiment</p>
                                  <p className="font-semibold text-white">
                                    {detailsCache[result.call_id].nlp_analysis.sentiment?.overall || 'neutral'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-white/50">Intent</p>
                                  <p className="font-semibold text-white">
                                    {detailsCache[result.call_id].nlp_analysis.intent?.detected || 'unknown'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-white/50">Risk</p>
                                  <p className="font-semibold text-white">
                                    {detailsCache[result.call_id].nlp_analysis.risk?.escalation_risk || 'low'}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-white/60">
                                No NLP analysis available for this call.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Pagination Info removed (debug helper) */}

      {/* Debug Information removed */}
    </div>
  )
}

export default Transcripts

// Local component for rendering formatted transcript
const TranscriptBlock: React.FC<{ text: string; enabled: boolean; sentencesPerParagraph: number }> = ({ text, enabled, sentencesPerParagraph }) => {
  if (!text || !text.trim()) {
    return <div className="text-sm text-white/60">No transcript available</div>
  }

  if (!enabled) {
    return (
      <div className="whitespace-pre-wrap text-sm text-white/80">
        {text}
      </div>
    )
  }

  // For very long transcripts, simple guard (render anyway but keep efficient)
  const paragraphs = formatTranscript(text, { sentencesPerParagraph, preserveExistingNewlines: true })

  return (
    <div className="space-y-3">
      {paragraphs.map((p, idx) => (
        <p key={idx} className="text-sm leading-6 text-white/80">
          {p}
        </p>
      ))}
    </div>
  )
}

function LiveTranscript({ callId }: { callId: string }) {
  const { text, completed, error, progress } = useTranscriptionStream(callId)
  if (error) {
    return <div className="text-xs text-white/60">Live updates unavailable.</div>
  }
  return (
    <div>
      {progress != null && !completed && (
        <div className="mb-1 text-xs text-white/70">Progress: {Math.round(progress)}%</div>
      )}
      <div className="min-h-[2rem] whitespace-pre-wrap text-sm text-white/80">
        {text || (!completed ? 'Waiting for partial results…' : 'No text')}
      </div>
      {completed && <div className="mt-1 text-xs text-emerald-200">Completed</div>}
    </div>
  )
}
