export type AppTab = 'capture' | 'transcripts' | 'settings'

export const navTabs: Array<{
  id: AppTab
  label: string
  icon: string
  glow: 'cyan' | 'purple' | 'blue'
}> = [
  { id: 'capture', label: 'Capture', icon: '🎙️', glow: 'cyan' },
  { id: 'transcripts', label: 'Transcripts', icon: '📄', glow: 'purple' },
  { id: 'settings', label: 'Settings', icon: '⚙️', glow: 'blue' },
]

