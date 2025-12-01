import React from 'react'
import { motion } from 'framer-motion'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  glow?: 'cyan' | 'purple' | 'pink' | 'green' | 'blue'
  isLoading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-900 shadow-glow',
  secondary: 'bg-white/10 text-white hover:bg-white/20 border border-white/20',
  danger: 'bg-gradient-to-r from-pink-500 to-red-500 text-white shadow-glow-pink',
  success: 'bg-gradient-to-r from-emerald-400 to-green-500 text-slate-900 shadow-glow-green',
  ghost: 'bg-transparent text-white border border-white/20 hover:bg-white/10',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-sm px-4 py-2',
  md: 'text-base px-5 py-2.5',
  lg: 'text-lg px-6 py-3',
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  glow = 'cyan',
  isLoading = false,
  disabled,
  className = '',
  children,
  ...rest
}) => {
  const isDisabled = disabled || isLoading
  return (
    <motion.button
      className={[
        'relative overflow-hidden rounded-2xl font-semibold uppercase tracking-wide transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
        variantClasses[variant],
        sizeClasses[size],
        isDisabled ? 'opacity-60 cursor-not-allowed' : 'hover:translate-y-[-1px]',
        className,
      ].join(' ')}
      disabled={isDisabled}
      data-glow={glow}
      {...rest}
      whileTap={{ scale: isDisabled ? 1 : 0.97 }}
      whileHover={isDisabled ? undefined : { scale: 1.01 }}
    >
      {isLoading && (
        <span className="mr-2 inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {children}
      <span
        className="pointer-events-none absolute inset-[-40%] opacity-30 blur-2xl"
        style={{
          background:
            glow === 'purple'
              ? 'radial-gradient(circle, rgba(168,85,247,0.6), transparent 60%)'
              : glow === 'pink'
                ? 'radial-gradient(circle, rgba(255,27,107,0.45), transparent 60%)'
                : glow === 'green'
                  ? 'radial-gradient(circle, rgba(74,222,128,0.5), transparent 60%)'
                  : 'radial-gradient(circle, rgba(50,245,255,0.5), transparent 60%)',
        }}
        aria-hidden
      />
    </motion.button>
  )
}

export default Button
