import React, { useEffect, useRef, useState } from 'react'
import { Logo, Navigation } from './index'
import type { AppTab, UpdateManifest } from '../../types'

interface HeaderProps {
  activePage: AppTab
  onPageChange: (page: AppTab) => void
  onMenuToggle: () => void
  updateInfo?: UpdateManifest | null
  dismissedVersion?: string | null
  onDismissUpdate?: (version: string) => void
  onDownloadUpdate?: () => Promise<unknown>
}

const Header: React.FC<HeaderProps> = ({
  activePage,
  onPageChange,
  onMenuToggle,
  updateInfo,
  dismissedVersion,
  onDismissUpdate,
  onDownloadUpdate,
}) => {
  const isMountedRef = useRef(true)
  const [isLaunchingDownload, setIsLaunchingDownload] = useState(false)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (updateInfo) {
      console.log('[HEADER] Update available', updateInfo)
    }
  }, [updateInfo])

  const showUpdateBanner = updateInfo && updateInfo.latestVersion !== dismissedVersion

  const handleDownloadClick = () => {
    if (isLaunchingDownload) {
      console.warn('[HEADER] Download click ignored because launch is in progress')
      return
    }

    console.log('[HEADER] Download click accepted, launching update flow')
    setIsLaunchingDownload(true)

    const notifyFailure = () => {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('We could not open the download link. Please try again or download from GitHub releases.')
      }
    }

    try {
      const result = onDownloadUpdate?.()
      Promise.resolve(result)
        .then(() => {
          console.log('[HEADER] Update download flow resolved successfully')
        })
        .catch((error: unknown) => {
          console.error('[HEADER] Failed to launch update download', error)
          notifyFailure()
        })
        .finally(() => {
          if (isMountedRef.current) {
            console.log('[HEADER] Download button state reset')
            setIsLaunchingDownload(false)
          }
        })
    } catch (error) {
      console.error('[HEADER] Update download handler threw synchronously', error)
      notifyFailure()
      if (isMountedRef.current) {
        setIsLaunchingDownload(false)
      }
    }
  }

  return (
    <header className="relative z-10 px-4 pt-6 pb-4 lg:px-8">
      {showUpdateBanner && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-cyan-100 backdrop-blur-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-white">Update available · v{updateInfo.latestVersion}</p>
              {Array.isArray(updateInfo.releaseNotes) && (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-200/80">
                  {updateInfo.releaseNotes.slice(0, 2).map((note: string, idx: number) => (
                    <li key={`release-note-${idx}`}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadClick}
                className={`rounded-full px-4 py-2 text-sm font-medium shadow-glow ${
                  isLaunchingDownload
                    ? 'bg-white/20 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-900 hover:from-cyan-300 hover:to-blue-400'
                }`}
                disabled={isLaunchingDownload}
              >
                {isLaunchingDownload ? 'Opening download…' : 'Download update'}
              </button>
              <button
                type="button"
                onClick={() => onDismissUpdate?.(updateInfo.latestVersion)}
                className="rounded-full border border-white/30 px-4 py-2 text-sm text-white/80 hover:text-white"
              >
                Remind me later
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="glass-surface relative rounded-3xl border border-white/10 px-5 py-4 shadow-glow lg:px-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onMenuToggle}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white shadow-glow lg:hidden"
              >
                <span className="sr-only">Open navigation</span>
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
                  <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M5 7h14M5 12h14M5 17h10" />
                </svg>
              </button>
              <Logo size="lg" onClick={() => onPageChange('capture')} />
            </div>
            <div className="hidden items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-300 md:flex">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-glow" />
              <span>Live · System Online</span>
            </div>
          </div>
          <Navigation activePage={activePage} onPageChange={onPageChange} />
        </div>
      </div>
    </header>
  )
}

export default Header
