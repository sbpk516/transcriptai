import React, { useState } from 'react'
import { useLicense, type LicenseStatus, type ActivateResult } from './useLicense'

// Promo price: struck-through anchor price + the discounted price.
function PriceTag({ status }: { status: LicenseStatus }) {
  return (
    <span className="whitespace-nowrap">
      {status.originalPrice && (
        <span className="mr-1.5 text-white/40 line-through">{status.originalPrice}</span>
      )}
      <strong className="text-white">{status.price}</strong>
    </span>
  )
}

interface ActivateFieldProps {
  activate: (token: string) => Promise<ActivateResult>
  autoFocus?: boolean
}

function ActivateField({ activate, autoFocus }: ActivateFieldProps) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onActivate = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await activate(token.trim())
    setBusy(false)
    if (!res.ok) setError(res.error || 'Activation failed.')
    // On success the guard re-renders (status -> licensed); nothing else to do.
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={token}
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={e => setToken(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void onActivate() }}
          placeholder="Paste your license token"
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
        <button
          onClick={() => void onActivate()}
          disabled={busy || !token.trim()}
          className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Activating…' : 'Activate'}
        </button>
      </div>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  )
}

function TrialBanner({ status, onClose, onBuy, activate }: {
  status: LicenseStatus
  onClose: () => void
  onBuy: () => void
  activate: (token: string) => Promise<ActivateResult>
}) {
  const [showActivate, setShowActivate] = useState(false)
  const days = status.daysRemaining
  return (
    <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          🎁 <strong>{days} day{days === 1 ? '' : 's'}</strong> left in your free trial. Unlock the full app for <PriceTag status={status} />
          {status.promoLabel ? <em className="not-italic text-amber-200/80"> — {status.promoLabel}</em> : null}.
        </span>
        <button onClick={onBuy} className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-300">
          Buy — {status.price}
        </button>
        <button onClick={() => setShowActivate(v => !v)} className="text-xs underline decoration-amber-300/50 underline-offset-2 hover:text-white">
          Have a token?
        </button>
        <button onClick={onClose} aria-label="Dismiss" className="ml-auto text-amber-200/70 hover:text-white" title="Dismiss for now">
          ✕
        </button>
      </div>
      {showActivate && (
        <div className="mt-2 max-w-md">
          <ActivateField activate={activate} autoFocus />
        </div>
      )}
    </div>
  )
}

function LicenseGate({ status, onBuy, activate }: {
  status: LicenseStatus
  onBuy: () => void
  activate: (token: string) => Promise<ActivateResult>
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 p-6 backdrop-blur">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-7 shadow-2xl">
        <div className="mb-1 text-2xl">🔒</div>
        <h2 className="text-xl font-semibold text-white">Your free trial has ended</h2>
        <p className="mt-2 text-sm text-white/60">
          Thanks for trying TranscriptAI. To keep using the app, purchase a one-time
          license for <PriceTag status={status} /> and paste your token below.
          {status.promoLabel ? <span className="text-cyan-300/80"> {status.promoLabel}.</span> : null}
        </p>

        <button
          onClick={onBuy}
          className="mt-5 w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400"
        >
          Buy a license — {status.price}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-widest text-white/30">
          <div className="h-px flex-1 bg-white/10" /> already purchased? <div className="h-px flex-1 bg-white/10" />
        </div>

        <ActivateField activate={activate} autoFocus />
      </div>
    </div>
  )
}

/**
 * Wraps the app. During the trial it shows a dismissable top banner (reappears each
 * launch). After the trial expires with no valid token, it blocks the entire app
 * with a license gate until a valid token is entered.
 */
export function LicenseGuard({ children }: { children: React.ReactNode }) {
  const { status, activate, openPurchase } = useLicense()
  const [dismissed, setDismissed] = useState(false)

  // While loading (or licensed / non-Electron), render the app normally.
  if (status.state === 'loading' || status.state === 'licensed') {
    return <>{children}</>
  }

  if (status.state === 'expired') {
    return <LicenseGate status={status} onBuy={openPurchase} activate={activate} />
  }

  // trial
  return (
    <>
      {!dismissed && (
        <TrialBanner
          status={status}
          onClose={() => setDismissed(true)}
          onBuy={openPurchase}
          activate={activate}
        />
      )}
      {children}
    </>
  )
}

export default LicenseGuard
