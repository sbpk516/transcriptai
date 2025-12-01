import React from 'react'
import { motion } from 'framer-motion'
import { navTabs, type AppTab } from '../../types'

interface NavigationProps {
  activePage: AppTab
  onPageChange: (page: AppTab) => void
}

const glowClass = {
  cyan: 'shadow-glow after:from-cyan-300 after:to-blue-400',
  purple: 'shadow-glow-purple after:from-purple-300 after:to-pink-400',
  blue: 'shadow-glow after:from-blue-300 after:to-slate-300',
} as const

const Navigation: React.FC<NavigationProps> = ({ activePage, onPageChange }) => {
  return (
    <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3">
      {navTabs.map((item, index) => {
        const isActive = activePage === item.id
        return (
          <motion.button
            key={item.id}
            onClick={() => onPageChange(item.id)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`neon-border relative flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 text-left text-sm uppercase tracking-wide text-white/70 transition-transform duration-200 hover:scale-[1.01] ${
              isActive
                ? `bg-gradient-to-r from-white/15 via-white/5 to-white/15 text-white shadow-[0_0_25px_rgba(50,245,255,0.35)] ${glowClass[item.glow]}`
                : 'bg-white/5 hover:bg-white/10'
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <span>{item.icon}</span>
              {item.label}
            </span>
            {isActive && (
              <span className="rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[0.45rem] font-semibold uppercase tracking-[0.45em] text-cyan-100 shadow-[0_0_10px_rgba(50,245,255,0.5)]">
                Active
              </span>
            )}
          </motion.button>
        )
      })}
    </nav>
  )
}

export default Navigation
