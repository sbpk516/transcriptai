import { useCallback, useEffect, useState } from 'react'

export type LicenseState = 'loading' | 'trial' | 'expired' | 'licensed'

export interface LicenseStatus {
  state: LicenseState
  daysRemaining: number
  trialDays: number
  price: string
  originalPrice?: string
  promoLabel?: string
  purchaseUrl: string
  licensedTo?: string | null
  plan?: string
}

export interface ActivateResult {
  ok: boolean
  error?: string
}

interface LicenseBridge {
  getStatus(): Promise<Record<string, unknown>>
  activate(token: string): Promise<Record<string, unknown>>
  openPurchase(): Promise<unknown>
}

function getBridge(): LicenseBridge | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { transcriptaiLicense?: LicenseBridge }).transcriptaiLicense ?? null
}

const DEFAULTS: LicenseStatus = {
  state: 'loading',
  daysRemaining: 0,
  trialDays: 15,
  price: '$18.83',
  originalPrice: '$100.83',
  promoLabel: 'Launch offer for early users',
  purchaseUrl: '',
}

function toStatus(raw: Record<string, unknown>): LicenseStatus {
  return {
    state: (raw.state as LicenseState) || 'licensed',
    daysRemaining: Number(raw.daysRemaining ?? 0),
    trialDays: Number(raw.trialDays ?? 15),
    price: String(raw.price ?? DEFAULTS.price),
    originalPrice: (raw.originalPrice as string | undefined) ?? DEFAULTS.originalPrice,
    promoLabel: (raw.promoLabel as string | undefined) ?? DEFAULTS.promoLabel,
    purchaseUrl: String(raw.purchaseUrl ?? ''),
    licensedTo: (raw.licensedTo as string | null | undefined) ?? null,
    plan: (raw.plan as string | undefined) ?? undefined,
  }
}

/**
 * Trial/license status from the Electron main process. When no bridge is present
 * (e.g. plain browser/dev without Electron), licensing is not enforced.
 */
export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus>(DEFAULTS)

  const refresh = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) {
      // Non-Electron context: no gating.
      setStatus(s => ({ ...s, state: 'licensed' }))
      return
    }
    try {
      const raw = await bridge.getStatus()
      if (raw && raw.ok) setStatus(toStatus(raw))
      else setStatus(s => ({ ...s, state: 'licensed' })) // fail-open on transient IPC error
    } catch {
      setStatus(s => ({ ...s, state: 'licensed' }))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const activate = useCallback(async (token: string): Promise<ActivateResult> => {
    const bridge = getBridge()
    if (!bridge) return { ok: false, error: 'Licensing is only available in the desktop app.' }
    try {
      const raw = await bridge.activate(token)
      if (raw && raw.ok) {
        if (raw.status) setStatus(toStatus(raw.status as Record<string, unknown>))
        else await refresh()
        return { ok: true }
      }
      return { ok: false, error: String(raw?.error || 'Activation failed.') }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Activation failed.' }
    }
  }, [refresh])

  const openPurchase = useCallback(() => {
    const bridge = getBridge()
    void bridge?.openPurchase?.()
  }, [])

  return { status, refresh, activate, openPurchase }
}
