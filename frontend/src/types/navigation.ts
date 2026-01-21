export type AppTab = 'capture' | 'transcripts' | 'chat' | 'dashboard' | 'settings'

export const navTabs: Array<{
  id: AppTab
  label: string
  icon: string
  glow: 'cyan' | 'purple' | 'blue' | 'emerald'
}> = [
    { id: 'capture', label: 'Capture', icon: '🎙️', glow: 'cyan' },
    { id: 'transcripts', label: 'Transcripts', icon: '📄', glow: 'purple' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', glow: 'emerald' },
    { id: 'settings', label: 'Settings', icon: '⚙️', glow: 'blue' },
  ]

