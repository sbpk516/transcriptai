/**
 * Dashboard page component - displays transcription statistics.
 *
 * TRAN-15: Create Dashboard page component
 * TRAN-17: Connect Dashboard to stats API
 */
import React, { useEffect, useState, useCallback } from 'react'
import { TranscriptionStats } from '../components/TranscriptionStats'
import type { TranscriptionData } from '../components/TranscriptionStats/TranscriptionStats'

// API base URL - uses the backend server
const API_BASE = 'http://localhost:8001'

interface DashboardProps {
  className?: string
}

export function Dashboard({ className = '' }: DashboardProps) {
  const [stats, setStats] = useState<TranscriptionData | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`${API_BASE}/api/v1/stats`)

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.statusText}`)
      }

      const data = await response.json()
      setStats(data)
    } catch (err) {
      console.error('[Dashboard] Failed to fetch stats:', err)
      setError(err instanceof Error ? err.message : 'Failed to load statistics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [fetchStats])

  return (
    <div className={`space-y-8 ${className}`}>
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-slate-400">
          Overview of your transcription activity and statistics
        </p>
      </div>

      {/* Statistics Section */}
      <div className="flex justify-center">
        {error ? (
          <div className="w-full max-w-3xl bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
            <p className="text-red-400 mb-2">Failed to load statistics</p>
            <p className="text-sm text-slate-400">{error}</p>
            <button
              onClick={fetchStats}
              className="mt-4 px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <TranscriptionStats data={stats} variant="expanded" loading={loading} />
        )}
      </div>

      {/* Additional Stats Cards */}
      {!loading && !error && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Average Duration Card */}
          <div className="p-6 rounded-xl bg-slate-800/30 border border-slate-700/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm text-slate-400 uppercase tracking-wider">Average Duration</h3>
              <svg
                className="w-5 h-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="text-3xl text-slate-200 mb-2">
              {calculateAverageDuration(stats)} min
            </div>
            <p className="text-xs text-slate-500">Per transcription session</p>
          </div>

          {/* Most Active Source Card */}
          <div className="p-6 rounded-xl bg-slate-800/30 border border-slate-700/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm text-slate-400 uppercase tracking-wider">Most Active Source</h3>
              <svg
                className="w-5 h-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <div className="text-3xl text-slate-200 mb-2">{getMostActiveSource(stats)}</div>
            <p className="text-xs text-slate-500">Highest transcription volume</p>
          </div>

          {/* Total Items Card */}
          <div className="p-6 rounded-xl bg-slate-800/30 border border-slate-700/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm text-slate-400 uppercase tracking-wider">Total Items</h3>
              <svg
                className="w-5 h-5 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <div className="text-3xl text-slate-200 mb-2">{getTotalCount(stats)}</div>
            <p className="text-xs text-slate-500">Total transcriptions completed</p>
          </div>
        </div>
      )}

      {/* Info Message */}
      <div className="p-4 rounded-lg bg-slate-800/20 border border-slate-700/30">
        <p className="text-sm text-slate-400 text-center">
          Statistics are updated automatically. More analytics features coming soon.
        </p>
      </div>
    </div>
  )
}

// Helper functions
function calculateAverageDuration(stats: TranscriptionData): number {
  const totalMinutes =
    stats.audioFiles.minutes + stats.liveRecordings.minutes + stats.youtubeVideos.minutes
  const totalCount = stats.audioFiles.count + stats.liveRecordings.count + stats.youtubeVideos.count

  if (totalCount === 0) return 0
  return Math.round(totalMinutes / totalCount)
}

function getMostActiveSource(stats: TranscriptionData): string {
  const sources = [
    { name: 'Audio Files', minutes: stats.audioFiles.minutes },
    { name: 'Live Recordings', minutes: stats.liveRecordings.minutes },
    { name: 'YouTube', minutes: stats.youtubeVideos.minutes },
  ]

  const sorted = sources.sort((a, b) => b.minutes - a.minutes)

  if (sorted[0].minutes === 0) return 'None yet'
  return sorted[0].name
}

function getTotalCount(stats: TranscriptionData): number {
  return stats.audioFiles.count + stats.liveRecordings.count + stats.youtubeVideos.count
}

export default Dashboard
