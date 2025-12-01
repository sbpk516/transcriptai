export const glassTheme = {
  palette: {
    background: {
      deep: '#030712',
      surface: 'rgba(15, 23, 42, 0.75)',
      border: 'rgba(226, 232, 240, 0.12)',
    },
    gradient: [
      '#32F5FF',
      '#5B7CFF',
      '#A855F7',
    ],
    glow: {
      cyan: '#32F5FF',
      blue: '#5B7CFF',
      purple: '#A855F7',
      pink: '#FF1B6B',
      red: '#FF375F',
      green: '#4ADE80',
    },
  },
  blur: {
    card: 24,
    surface: 30,
  },
  shadow: {
    glass: '0 15px 45px rgba(3, 7, 18, 0.65)',
    glow: (color: string, amount = 0.5) => `0 0 30px rgba(${color}, ${amount})`,
  },
  motion: {
    default: { type: 'spring', stiffness: 120, damping: 18 },
    float: { duration: 6, repeat: Infinity, ease: 'easeInOut' },
    reveal: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
  },
} as const

export type GlassTheme = typeof glassTheme

