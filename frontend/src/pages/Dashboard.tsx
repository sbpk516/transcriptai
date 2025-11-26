import React, { useEffect, useMemo, useState } from 'react'
import { Card } from '../components/Shared'
import { fetchResults } from '@/services/api/results'

type Stat = {
  label: string
  value: string
  subtext?: string
  icon: string
  color: 'blue' | 'green' | 'yellow' | 'purple'
}

const formatDuration = (seconds: number) => {
  if (!seconds || seconds <= 0) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const timeAgo = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Math.max(0, Date.now() - d.getTime()) / 1000
  const mins = Math.floor(diff / 60)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${days} day${days === 1 ? '' : 's'} ago`
}

type DashboardProps = {
  onNavigate?: (page: 'dashboard' | 'capture' | 'transcripts') => void
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalCalls, setTotalCalls] = useState<number>(0)
  const [processedTotal, setProcessedTotal] = useState<number>(0)
  const [pendingTotal, setPendingTotal] = useState<number>(0)
  const [recent, setRecent] = useState<any[]>([])
  const [durationSum, setDurationSum] = useState<number>(0)
  const retryTimeout = React.useRef<number | null>(null)

  useEffect(() => {
    const waitForHealth = async () => {
      // Retry /health briefly on app start to avoid initial network race
      const maxAttempts = 20
      const delayMs = 500
      const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:'
      const electronPort = (typeof window !== 'undefined' && (window as any)?.api?.backend?.port) || null
      const healthUrl = isFileProtocol && electronPort
        ? `http://127.0.0.1:${electronPort}/health`
        : '/health'
      for (let i = 0; i < maxAttempts; i++) {
        try {
          // use raw fetch to avoid axios interceptors changing behavior
          const res = await fetch(healthUrl, { method: 'GET' })
          if (res.ok) return true
        } catch (_) {}
        await new Promise(r => setTimeout(r, delayMs))
      }
      return false
    }

    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // Ensure backend is ready (avoids brief Network Error on first paint)
        const healthy = await waitForHealth()
        if (!healthy) {
          setLoading(false)
          setError('Backend is starting...')
          if (retryTimeout.current) window.clearTimeout(retryTimeout.current)
          retryTimeout.current = window.setTimeout(() => {
            load()
          }, 1500)
          return
        }

        // Accurate totals using filtered queries for counts
        const [allRes, completedRes, processingRes, uploadedRes, latestRes] = await Promise.all([
          fetchResults({ limit: 1 }),
          fetchResults({ status: 'completed', limit: 1 }),
          fetchResults({ status: 'processing', limit: 1 }),
          fetchResults({ status: 'uploaded', limit: 1 }),
          fetchResults({ limit: 100, offset: 0 })
        ])

        setTotalCalls(allRes.data.total || 0)
        setProcessedTotal(completedRes.data.total || 0)
        setPendingTotal((processingRes.data.total || 0) + (uploadedRes.data.total || 0))

        const items = (latestRes.data.results || [])
          .slice()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setRecent(items.slice(0, 5))

        const dur = items.reduce((acc, r) => {
          const seconds = (r as any)?.audio_analysis?.duration_seconds
          return acc + (typeof seconds === 'number' ? seconds : 0)
        }, 0)
        setDurationSum(dur)
      } catch (err) {
        // Be tolerant at startup: if the only error is network/ready, try once more
        try {
          const msg = err instanceof Error ? err.message : 'Failed to load dashboard data'
          if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('ready')) {
            const healthy = await waitForHealth()
            if (healthy) {
              // Re-run the loader once
              return load()
            }
          }
          setError(msg)
        } catch (e) {
          const msg2 = e instanceof Error ? e.message : 'Failed to load dashboard data'
          setError(msg2)
        }
      } finally {
        setLoading(false)
      }
    }
    load()

    return () => {
      if (retryTimeout.current) {
        window.clearTimeout(retryTimeout.current)
      }
    }
  }, [])

  const stats: Stat[] = useMemo(() => ([
    { label: 'Total Calls', value: String(totalCalls), subtext: undefined, icon: '📞', color: 'blue' },
    { label: 'Processed Audio', value: String(processedTotal), subtext: undefined, icon: '✅', color: 'green' },
    { label: 'Pending Analysis', value: String(pendingTotal), subtext: 'uploaded or processing', icon: '⏳', color: 'yellow' },
    { label: 'Total Duration', value: formatDuration(durationSum), subtext: 'last 100 calls', icon: '⏱️', color: 'purple' },
  ]), [totalCalls, processedTotal, pendingTotal, durationSum])

  const colorClasses = (c: Stat['color']) => {
    switch (c) {
      case 'blue':
        return {
          card: 'from-blue-50 to-blue-100 border-blue-200',
          label: 'text-blue-600',
          value: 'text-blue-900',
          icon: 'text-blue-400',
        }
      case 'green':
        return {
          card: 'from-green-50 to-green-100 border-green-200',
          label: 'text-green-600',
          value: 'text-green-900',
          icon: 'text-green-400',
        }
      case 'yellow':
        return {
          card: 'from-yellow-50 to-yellow-100 border-yellow-200',
          label: 'text-yellow-600',
          value: 'text-yellow-900',
          icon: 'text-yellow-400',
        }
      case 'purple':
      default:
        return {
          card: 'from-purple-50 to-purple-100 border-purple-200',
          label: 'text-purple-600',
          value: 'text-purple-900',
          icon: 'text-purple-400',
        }
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-2">
            <span className="inline-flex items-center px-3 py-1 text-sm font-semibold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200 rounded-full">
              Welcome
            </span>
            <h1 className="text-3xl font-semibold tracking-tight bg-gradient-to-r from-blue-600 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              TranscriptAI · Your Audio Analysis Platform
            </h1>
            <p className="text-sm text-gray-500">Capture audio, transcribe instantly, and surface insights the moment your sessions finish.</p>
          </div>
          <div className="mt-4 lg:mt-0 lg:ml-6">
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span>System Online</span>
              </div>
              <div>
                Last updated: {new Date().toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards (dynamic) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((s) => {
          const cls = colorClasses(s.color)
          return (
          <Card key={s.label} className={`bg-gradient-to-br ${cls.card} hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium ${cls.label} mb-1`}>{s.label}</p>
                <p className={`text-3xl font-bold ${cls.value}`}>{s.value}</p>
                {s.subtext && (
                  <p className={`text-sm ${cls.label} mt-1`}>{s.subtext}</p>
                )}
              </div>
              <div className={`text-3xl ${cls.icon}`}>{s.icon}</div>
            </div>
          </Card>
        )})}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <Card title="Recent Activity" className="h-full">
            {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
            {error && (
              <div className="p-4 text-sm text-red-600">{error}</div>
            )}
            {!loading && !error && (
              <div className="space-y-4">
                {recent.length === 0 && (
                  <div className="p-4 text-sm text-gray-600">No recent activity</div>
                )}
                {recent.map((r) => {
                  const status = r.status
                  const color = status === 'completed' ? 'green' : status === 'processing' ? 'yellow' : status === 'failed' ? 'red' : 'blue'
                  const icon = status === 'completed' ? '✓' : status === 'processing' ? '⚙️' : status === 'failed' ? '⚠️' : '📤'
                  const title = status === 'completed' ? 'Processed successfully' : status === 'processing' ? 'Analysis in progress' : status === 'failed' ? 'Processing failed' : 'New upload'
                  const fileName = (r as any)?.file_info?.original_filename
                    || (r as any)?.file_info?.file_path?.split?.('/')?.pop()
                    || r.call_id
                  return (
                    <div key={r.call_id} className={
                      `flex items-start space-x-4 p-4 bg-gradient-to-r ${
                        color === 'green' ? 'from-green-50 to-green-100 border-green-200' :
                        color === 'yellow' ? 'from-yellow-50 to-yellow-100 border-yellow-200' :
                        color === 'red' ? 'from-red-50 to-red-100 border-red-200' :
                        'from-blue-50 to-blue-100 border-blue-200'
                      } rounded-lg border`
                    }>
                      <div className="flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          color === 'green' ? 'bg-green-500' :
                          color === 'yellow' ? 'bg-yellow-500' :
                          color === 'red' ? 'bg-red-500' :
                          'bg-blue-500'
                        }`}>
                          <span className="text-white text-sm font-bold">{icon}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{title}</p>
                        <p className="text-sm text-gray-500">{fileName}</p>
                        <p className="text-xs text-gray-400 mt-1">{timeAgo(r.created_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <Card title="Quick Actions" className="h-full">
            <div className="space-y-4">
              <button
                onClick={() => onNavigate?.('capture')}
                className="w-full p-4 border-2 border-dashed border-blue-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 group"
              >
                <div className="text-center">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">🎙️</div>
                  <div className="font-medium text-gray-900 group-hover:text-blue-700">Capture Audio</div>
                  <div className="text-sm text-gray-500 mt-1">Record live or upload existing audio</div>
                </div>
              </button>
              
              <button
                onClick={() => onNavigate?.('analytics')}
                className="w-full p-4 border-2 border-dashed border-green-300 rounded-lg hover:border-green-400 hover:bg-green-50 transition-all duration-200 group"
              >
                <div className="text-center">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">📊</div>
                  <div className="font-medium text-gray-900 group-hover:text-green-700">View Analytics</div>
                  <div className="text-sm text-gray-500 mt-1">Check insights</div>
                </div>
              </button>
              
              <button
                onClick={() => onNavigate?.('transcripts')}
                className="w-full p-4 border-2 border-dashed border-purple-300 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 group"
              >
                <div className="text-center">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">📄</div>
                  <div className="font-medium text-gray-900 group-hover:text-purple-700">View Transcripts</div>
                  <div className="text-sm text-gray-500 mt-1">Review recent transcription output</div>
                </div>
              </button>

              <button
                onClick={() => onNavigate?.('settings')}
                className="w-full p-4 border-2 border-dashed border-orange-300 rounded-lg hover:border-orange-400 hover:bg-orange-50 transition-all duration-200 group"
              >
                <div className="text-center">
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">⚙️</div>
                  <div className="font-medium text-gray-900 group-hover:text-orange-700">Settings</div>
                  <div className="text-sm text-gray-500 mt-1">Configure system</div>
                </div>
              </button>
            </div>
          </Card>
        </div>
      </div>

      {/* System Status */}
      <Card title="System Status" className="bg-gray-50 border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <div>
              <p className="text-sm font-medium text-gray-900">Audio Processing</p>
              <p className="text-xs text-gray-500">All systems operational</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <div>
              <p className="text-sm font-medium text-gray-900">NLP Analysis</p>
              <p className="text-xs text-gray-500">Models loaded and ready</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <div>
              <p className="text-sm font-medium text-gray-900">Database</p>
              <p className="text-xs text-gray-500">Connected and responsive</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default Dashboard
