import React from 'react'
import { motion } from 'framer-motion'
import type { AppTab } from '../../types'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  activePage: AppTab
  onPageChange: (page: AppTab) => void
}

const menuItems: Array<{
  id: AppTab
  label: string
  icon: string
  description: string
  accent: string
}> = [
  { id: 'capture', label: 'Capture', icon: '🎙️', description: 'Record or upload audio', accent: 'from-cyan-400 to-blue-500' },
  { id: 'transcripts', label: 'Transcripts', icon: '📄', description: 'History of transcripts', accent: 'from-purple-400 to-pink-500' },
  { id: 'settings', label: 'Settings', icon: '⚙️', description: 'Choose models', accent: 'from-blue-400 to-slate-400' },
]

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle, activePage, onPageChange }) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm lg:hidden"
          onClick={onToggle}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform p-4 transition-transform duration-300 lg:static lg:w-72 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="glass-surface flex h-full flex-col rounded-3xl border border-white/10 p-4 shadow-glow">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.3em] text-white/70">
            <span>Workflow</span>
            <button onClick={onToggle} className="lg:hidden">
              <span className="sr-only">Close navigation</span>
              <svg className="h-5 w-5 text-white/60" viewBox="0 0 24 24" fill="none">
                <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <nav className="mt-6 flex-1 space-y-3 overflow-y-auto pr-1">
            {menuItems.map((item, index) => {
              const isActive = activePage === item.id
              return (
                <motion.button
                  key={item.id}
                  onClick={() => onPageChange(item.id)}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ scale: 1.01 }}
                  className={`w-full rounded-2xl border border-white/10 px-4 py-4 text-left text-sm transition-all duration-200 ${
                    isActive
                      ? `bg-white/10 text-white shadow-glow hover:translate-y-[-2px]`
                      : 'bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{item.icon}</span>
                      <div>
                        <p className="text-base font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-white/60">{item.description}</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full bg-gradient-to-r ${item.accent} px-3 py-1 text-xs font-medium text-slate-900`}
                    >
                      {isActive ? 'Active' : 'Go'}
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </nav>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-xs text-white/70">
            <p className="text-sm font-semibold text-white">TranscriptAI · vNext</p>
            <div className="mt-3 flex items-center justify-center gap-2 text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-glow" />
              Stable connection
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
