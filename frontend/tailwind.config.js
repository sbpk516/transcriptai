/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', '"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        midnight: {
          900: '#030712',
          800: '#050A1F',
          700: '#0A112F',
        },
        glass: {
          base: 'rgba(15, 23, 42, 0.65)',
          light: 'rgba(30, 58, 138, 0.35)',
        },
        neon: {
          cyan: '#32F5FF',
          blue: '#5B7CFF',
          purple: '#A855F7',
          pink: '#FF1B6B',
          red: '#FF375F',
          green: '#4ADE80',
        },
      },
      backgroundImage: {
        'hero-gradient': 'radial-gradient(120% 120% at 50% 0%, #0f172a 0%, #030712 70%)',
      },
      boxShadow: {
        glow: '0 0 30px rgba(50, 245, 255, 0.45)',
        'glow-purple': '0 0 30px rgba(168, 85, 247, 0.4)',
        'glow-pink': '0 0 30px rgba(255, 27, 107, 0.4)',
        'glow-green': '0 0 30px rgba(74, 222, 128, 0.45)',
        'glass-sm': '0 8px 24px rgba(3, 7, 18, 0.65)',
      },
      dropShadow: {
        neon: '0 0 12px rgba(91, 124, 255, 0.75)',
      },
      animation: {
        'blob-pulse': 'blobPulse 18s ease-in-out infinite',
        'float-slow': 'floatSlow 12s ease-in-out infinite',
        'pulse-ring': 'pulseRing 2s ease-out infinite',
        'audio-bars': 'audioBars 1.2s ease-in-out infinite',
        'mic-ripple': 'micRipple 3s ease-out infinite',
      },
      keyframes: {
        blobPulse: {
          '0%, 100%': { transform: 'scale(1) translate(0, 0)', opacity: 0.35 },
          '50%': { transform: 'scale(1.25) translate(5%, 10%)', opacity: 0.55 },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.95)', opacity: 0.6 },
          '70%': { transform: 'scale(1.3)', opacity: 0 },
          '100%': { opacity: 0 },
        },
        audioBars: {
          '0%, 100%': { transform: 'scaleY(0.2)' },
          '50%': { transform: 'scaleY(1)' },
        },
        micRipple: {
          '0%': { boxShadow: '0 0 0 0 rgba(255, 27, 107, 0.5)' },
          '70%': { boxShadow: '0 0 0 20px rgba(255, 27, 107, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(255, 27, 107, 0)' },
        },
      },
    },
  },
  plugins: [],
}
