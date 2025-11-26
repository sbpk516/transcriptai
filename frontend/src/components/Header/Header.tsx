import React, { useEffect, useRef, useState } from 'react'
import { Logo, Navigation } from './index'

interface UpdateManifest {
  latestVersion: string
  downloadUrl: string
  releaseNotes?: string[]
  [key: string]: any
}

interface HeaderProps {
  activePage: 'dashboard' | 'capture' | 'transcripts' | 'analytics' | 'settings'
  onPageChange: (page: 'dashboard' | 'capture' | 'transcripts' | 'analytics' | 'settings') => void
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
    <header className="bg-white shadow-sm border-b border-gray-200">
      {showUpdateBanner && (
        <div className="bg-blue-50 border-b border-blue-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-blue-800">
            <div className="flex flex-col gap-1">
              <div>
                <strong>Update available:</strong> TranscriptAI {updateInfo.latestVersion}
              </div>
              {Array.isArray(updateInfo.releaseNotes) && updateInfo.releaseNotes.length > 0 && (
                <ul className="list-disc list-inside text-blue-700">
                  {updateInfo.releaseNotes.slice(0, 3).map((note: string, idx: number) => (
                    <li key={`release-note-${idx}`}>{note}</li>
                  ))}
                  {updateInfo.releaseNotes.length > 3 && (
                    <li>…</li>
                  )}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadClick}
                className={`px-3 py-1 rounded-md text-white transition ${isLaunchingDownload ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                disabled={isLaunchingDownload}
                aria-busy={isLaunchingDownload}
                aria-live="polite"
              >
                {isLaunchingDownload ? 'Opening download...' : 'Download'}
              </button>
              <button
                type="button"
                onClick={() => onDismissUpdate?.(updateInfo.latestVersion)}
                className="px-3 py-1 rounded-md text-blue-700 hover:text-blue-900"
              >
                Remind me later
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center">
            {/* Mobile menu button */}
            <button
              onClick={onMenuToggle}
              className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <span className="sr-only">Open sidebar</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            
            {/* Logo */}
            <div className="flex-shrink-0 flex items-center">
              <Logo size="md" onClick={() => onPageChange('dashboard')} />
            </div>
            
            {/* Navigation - hidden on mobile */}
            <div className="hidden lg:ml-8 lg:flex lg:items-center">
              <Navigation activePage={activePage} onPageChange={onPageChange} />
            </div>
          </div>
          
          {/* Right side - User info and actions */}
          <div className="flex items-center space-x-4">
            {/* Status indicator */}
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span>System Online</span>
            </div>
            
            {/* User menu placeholder */}
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">U</span>
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700">User</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
