import React from 'react'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
}

const Logo: React.FC<LogoProps> = ({ size = 'md', onClick }) => {
  const content = (
    <div className="flex items-center gap-3">
      <div className="relative h-11 w-11 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-500 p-[1px] shadow-glow">
        <div className="flex h-full w-full items-center justify-center rounded-[1rem] bg-slate-950/70">
          <span className="text-xl">🎧</span>
        </div>
        <span className="absolute inset-0 animate-pulse opacity-30 blur-2xl bg-gradient-to-br from-cyan-400 to-purple-500" aria-hidden />
      </div>
      <div className="text-left">
        <div className={`gradient-heading font-semibold leading-none ${sizeClasses[size]}`}>
          TranscriptAI
        </div>
        <p className="mt-1 text-sm uppercase tracking-[0.3em] text-white/60">
          Capture · Understand · Act
        </p>
      </div>
    </div>
  )

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="group rounded-2xl border border-transparent bg-transparent text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
      >
        {content}
      </button>
    )
  }

  return content
}

export default Logo
