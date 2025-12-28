# Glassmorphism UI System

The TranscriptAI frontend now runs on a dark glassmorphism system that mirrors the December 2025 design kit. This doc summarizes the shared tokens and interaction rules so future changes stay consistent.

## Foundations

- **Fonts**: `Space Grotesk` is the primary display/typeface with `Inter` for supporting copy. Loaded via `src/index.css`.
- **Palette**:
  - Backgrounds: `midnight.900` (`#030712`) and gradient alias `bg-hero-gradient`.
  - Glass surfaces: `glass.base` (`rgba(15, 23, 42, 0.65)`) with `border: rgba(226, 232, 240, 0.12)`.
  - Neon actions:
    - Capture/primary: `neon.cyan (#32F5FF)`
    - Transcripts/secondary: `neon.purple (#A855F7)`
    - Recording/destructive: `neon.pink (#FF1B6B)`
    - Success: `neon.green (#4ADE80)`
    - Status/info: `neon.blue (#5B7CFF)`
- **Shadows**: See `tailwind.config.js` for `shadow-glow`, `shadow-glow-purple`, `shadow-glow-pink`, `shadow-glow-green`, and `shadow-glass-sm`.
- **Blur & Borders**: `.glass-surface` utility wraps `backdrop-filter: blur(24px)` with consistent border/box-shadow.

## Utilities

- Gradient heading text (`.gradient-heading`)
- Animated blobs (`.blob` + `@keyframes blobDrift`)
- Grid overlay (`.bg-grid`) for page shells
- Neon border effect (`.neon-border`) for navigation tabs and floating chips

## Motion Layer

- `framer-motion` powers shell/view transitions:
  - Page transitions in `Layout` use `AnimatePresence` with a 0.45s fade/slide.
  - Navigation/Sidebar buttons use `motion.button` for hover/tap scaling and staggered reveals.
  - Shared `Card`/`Button` primitives animate into view on mount.
- CSS keyframes cover:
  - `blobPulse`, `floatSlow` for background blobs
  - `audioBars` for microphone visualizers
  - `micRipple` for the recording button halo

## Component Guidelines

1. Always wrap major panels with `Card` to inherit glass styling + motion.
2. Use `Button` variants to map neon glows to action intent.
3. Respect the color glow system (cyan primary, purple secondary, pink/red destructive, green success, blue info).
4. When adding new animations, prefer `framer-motion` for interactivity and CSS keyframes for purely decorative loops.
5. Dictation overlays should use the pre-defined neon gradients and `audioBars` animation when representing `recording` or `processing` states.

## Tokens

`src/theme/glass.ts` exports `glassTheme` with palette, blur, shadow, and motion definitions. Import it when components need programmatic access to shared values (e.g., advanced animations or custom gradients).

---

For further adjustments, keep screenshots or references aligned with [soft-wispy-20649097.figma.site](https://soft-wispy-20649097.figma.site) so the desktop + web UI stay mirrored.

