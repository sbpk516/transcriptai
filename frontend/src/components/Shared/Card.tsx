import React from 'react'
import { motion } from 'framer-motion'

type Padding = 'sm' | 'md' | 'lg'

interface CardProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  padding?: Padding
}

const paddingClasses: Record<Padding, string> = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  icon,
  children,
  className = '',
  padding = 'md',
}) => {
  return (
    <motion.section
      className={[
        'glass-surface rounded-3xl border border-white/10 shadow-glass-sm transition hover:border-white/20',
        paddingClasses[padding],
        className,
      ].join(' ')}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
    >
      {(title || subtitle || icon) && (
        <header className="mb-6 flex items-center justify-between">
          <div>
            {title && <h3 className="gradient-heading text-xl font-semibold">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-white/70">{subtitle}</p>}
          </div>
          {icon && <div className="text-2xl">{icon}</div>}
        </header>
      )}
      {children}
    </motion.section>
  )
}

export default Card
