/**
 * TranscriptionStats component - displays transcription statistics by source type.
 *
 * TRAN-12: Create TranscriptionStats React component
 * TRAN-13: Implement empty state
 * TRAN-14: Implement loading state
 */
import React from 'react'

// ============================================================================
// Types
// ============================================================================

export interface TranscriptionData {
  audioFiles: {
    minutes: number
    count: number
  }
  liveRecordings: {
    minutes: number
    count: number
  }
  youtubeVideos: {
    minutes: number
    count: number
  }
}

interface TranscriptionStatsProps {
  data?: TranscriptionData
  variant?: 'compact' | 'expanded'
  loading?: boolean
}

// ============================================================================
// Sub-components
// ============================================================================

interface StatCardProps {
  icon: React.ReactNode
  label: string
  minutes: number
  count: number
  countLabel: string
  color: 'blue' | 'green' | 'red'
}

const colorClasses = {
  blue: {
    bg: 'from-blue-500/20 to-blue-600/10',
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    hover: 'hover:border-blue-500/50',
  },
  green: {
    bg: 'from-green-500/20 to-green-600/10',
    border: 'border-green-500/30',
    icon: 'text-green-400',
    hover: 'hover:border-green-500/50',
  },
  red: {
    bg: 'from-red-500/20 to-red-600/10',
    border: 'border-red-500/30',
    icon: 'text-red-400',
    hover: 'hover:border-red-500/50',
  },
}

function StatCard({ icon, label, minutes, count, countLabel, color }: StatCardProps) {
  const classes = colorClasses[color]

  return (
    <div
      className={`bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border ${classes.border} p-5 transition-all duration-300 ${classes.hover} hover:shadow-lg cursor-default group`}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className={`p-2.5 rounded-lg bg-gradient-to-br ${classes.bg} border ${classes.border} group-hover:scale-110 transition-transform duration-300`}
        >
          <div className={classes.icon}>{icon}</div>
        </div>
      </div>
      <div>
        <div className="text-slate-400 mb-2">{label}</div>
        <div className="text-2xl text-slate-100 mb-1">{minutes.toLocaleString()} min</div>
        <div className="text-sm text-slate-500">
          {count} {countLabel}
        </div>
      </div>
    </div>
  )
}

interface StatRowProps {
  icon: React.ReactNode
  label: string
  minutes: number
  count: number
  color: 'blue' | 'green' | 'red'
}

function StatRow({ icon, label, minutes, count, color }: StatRowProps) {
  const rowColorClasses = {
    blue: { bg: 'bg-blue-500/10', icon: 'text-blue-400' },
    green: { bg: 'bg-green-500/10', icon: 'text-green-400' },
    red: { bg: 'bg-red-500/10', icon: 'text-red-400' },
  }

  const classes = rowColorClasses[color]

  return (
    <div className="flex items-center justify-between group hover:bg-slate-700/20 rounded-lg p-2 -mx-2 transition-colors">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${classes.bg}`}>
          <div className={classes.icon}>{icon}</div>
        </div>
        <span className="text-slate-300">{label}</span>
      </div>
      <div className="text-right">
        <div className="text-slate-200">{minutes.toLocaleString()} min</div>
        <div className="text-xs text-slate-500">{count} items</div>
      </div>
    </div>
  )
}

// ============================================================================
// Icons
// ============================================================================

const FileAudioIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
    />
  </svg>
)

const MicIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
    />
  </svg>
)

const YoutubeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
)

const BarChartIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
    />
  </svg>
)

// ============================================================================
// Empty State (TRAN-13)
// ============================================================================

function CompactEmptyState() {
  return (
    <div className="w-full max-w-md bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-slate-200">Usage Statistics</h3>
        <BarChartIcon className="w-5 h-5 text-cyan-400" />
      </div>
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-700/30 mb-3">
          <BarChartIcon className="w-6 h-6 text-slate-500" />
        </div>
        <p className="text-slate-400 mb-1">No transcriptions yet</p>
        <p className="text-xs text-slate-500">Start transcribing to see your stats</p>
      </div>
    </div>
  )
}

function ExpandedEmptyState() {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-6">
        <h2 className="text-slate-100 mb-1">Your Transcription Stats</h2>
        <p className="text-slate-400">Track your transcription activity across all sources</p>
      </div>

      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border border-slate-700/50 p-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-700/30 mb-4">
          <BarChartIcon className="w-8 h-8 text-slate-500" />
        </div>
        <h3 className="text-slate-200 mb-2">No transcriptions yet</h3>
        <p className="text-slate-400 max-w-md mx-auto">
          Upload an audio file, start a live recording, or transcribe a YouTube video to begin
          tracking your stats.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Loading State (TRAN-14)
// ============================================================================

function CompactLoadingState() {
  return (
    <div className="w-full max-w-md bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="h-5 w-32 bg-slate-700/50 rounded animate-pulse" />
        <div className="w-5 h-5 bg-slate-700/50 rounded animate-pulse" />
      </div>

      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between p-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-slate-700/50 rounded-lg animate-pulse" />
              <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
            </div>
            <div className="space-y-1">
              <div className="h-4 w-20 bg-slate-700/50 rounded ml-auto animate-pulse" />
              <div className="h-3 w-16 bg-slate-700/50 rounded ml-auto animate-pulse" />
            </div>
          </div>
        ))}

        <div className="pt-3 border-t border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-slate-700/50 rounded-lg animate-pulse" />
              <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
            </div>
            <div className="space-y-1">
              <div className="h-4 w-24 bg-slate-700/50 rounded ml-auto animate-pulse" />
              <div className="h-3 w-20 bg-slate-700/50 rounded ml-auto animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExpandedLoadingState() {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-6">
        <div className="h-6 w-56 bg-slate-700/50 rounded mb-2 animate-pulse" />
        <div className="h-4 w-80 bg-slate-700/50 rounded animate-pulse" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-slate-700/50 rounded-lg animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-7 w-32 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-4 w-20 bg-slate-700/50 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-slate-700/50 rounded-xl animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-3 w-20 bg-slate-700/50 rounded animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-8 w-32 bg-slate-700/50 rounded ml-auto animate-pulse" />
            <div className="h-4 w-28 bg-slate-700/50 rounded ml-auto animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function TranscriptionStats({
  data,
  variant = 'expanded',
  loading = false,
}: TranscriptionStatsProps) {
  // Calculate totals
  const totalMinutes = data
    ? data.audioFiles.minutes + data.liveRecordings.minutes + data.youtubeVideos.minutes
    : 0
  const totalHours = (totalMinutes / 60).toFixed(1)
  const totalCount = data
    ? data.audioFiles.count + data.liveRecordings.count + data.youtubeVideos.count
    : 0

  const isEmpty = !data || totalMinutes === 0

  if (loading) {
    return variant === 'compact' ? <CompactLoadingState /> : <ExpandedLoadingState />
  }

  if (isEmpty) {
    return variant === 'compact' ? <CompactEmptyState /> : <ExpandedEmptyState />
  }

  if (variant === 'compact') {
    return (
      <div className="w-full max-w-md bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-200">Usage Statistics</h3>
          <BarChartIcon className="w-5 h-5 text-cyan-400" />
        </div>

        <div className="space-y-3">
          <StatRow
            icon={<FileAudioIcon className="w-4 h-4" />}
            label="Audio Files"
            minutes={data.audioFiles.minutes}
            count={data.audioFiles.count}
            color="blue"
          />
          <StatRow
            icon={<MicIcon className="w-4 h-4" />}
            label="Live Recordings"
            minutes={data.liveRecordings.minutes}
            count={data.liveRecordings.count}
            color="green"
          />
          <StatRow
            icon={<YoutubeIcon className="w-4 h-4" />}
            label="YouTube Videos"
            minutes={data.youtubeVideos.minutes}
            count={data.youtubeVideos.count}
            color="red"
          />

          <div className="pt-3 border-t border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/10">
                  <BarChartIcon className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-slate-300">Total</span>
              </div>
              <div className="text-right">
                <div className="text-slate-200">{totalHours} hours</div>
                <div className="text-xs text-slate-500">{totalMinutes.toLocaleString()} minutes</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Expanded variant
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-6">
        <h2 className="text-slate-100 mb-1">Your Transcription Stats</h2>
        <p className="text-slate-400">Track your transcription activity across all sources</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard
          icon={<FileAudioIcon className="w-5 h-5" />}
          label="Audio Files"
          minutes={data.audioFiles.minutes}
          count={data.audioFiles.count}
          countLabel="files"
          color="blue"
        />
        <StatCard
          icon={<MicIcon className="w-5 h-5" />}
          label="Live Recordings"
          minutes={data.liveRecordings.minutes}
          count={data.liveRecordings.count}
          countLabel="sessions"
          color="green"
        />
        <StatCard
          icon={<YoutubeIcon className="w-5 h-5" />}
          label="YouTube Videos"
          minutes={data.youtubeVideos.minutes}
          count={data.youtubeVideos.count}
          countLabel="videos"
          color="red"
        />
      </div>

      <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6 hover:border-purple-500/30 transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/30">
              <BarChartIcon className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <div className="text-slate-300 mb-0.5">Total Transcribed</div>
              <div className="text-xs text-slate-500">{totalCount} items</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl text-slate-100 mb-0.5">{totalHours} hours</div>
            <div className="text-sm text-slate-400">{totalMinutes.toLocaleString()} minutes</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TranscriptionStats
