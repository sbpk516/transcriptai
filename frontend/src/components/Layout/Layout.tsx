import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Header } from '../Header'
import { Sidebar } from '../Sidebar'
import { Capture, Transcripts, Settings } from '../../pages'
import { DictationOverlay } from '../../modules/dictation/dictationOverlay'
import type { AppTab, UpdateBridge, UpdateManifest } from '../../types'

const Layout: React.FC = () => {
  console.log('[LAYOUT] Component rendering...')
  
  const [activePage, setActivePage] = useState<AppTab>('capture')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateManifest | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  useEffect(() => {
    const bridge = (window as typeof window & { transcriptaiUpdates?: UpdateBridge }).transcriptaiUpdates
    if (!bridge || typeof bridge.onAvailable !== 'function') {
      console.warn('[LAYOUT] Update bridge is not available')
      return
    }

    const unsubscribe = bridge.onAvailable((manifest: UpdateManifest) => {
      console.log('[LAYOUT] Update manifest received', manifest)
      setUpdateInfo(manifest)
    })

    const current = bridge.getLatestManifest?.()
    if (current) {
      console.log('[LAYOUT] Using cached update manifest', current)
      setUpdateInfo(current)
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  const handleDismissUpdate = useCallback((version: string) => {
    console.log('[LAYOUT] Update dismissed for version', version)
    setDismissedVersion(version)
  }, [])

  const handleDownloadUpdate = useCallback(() => {
    console.log('[LAYOUT] Download update clicked')
    const bridge = (window as typeof window & { transcriptaiUpdates?: UpdateBridge }).transcriptaiUpdates

    try {
      const result = bridge?.openDownload?.()
      return Promise.resolve(result).catch((error: unknown) => {
        console.error('[LAYOUT] Failed to open update download', error)
        throw error
      })
    } catch (error) {
      console.error('[LAYOUT] Download handler threw synchronously', error)
      return Promise.reject(error)
    }
  }, [])

  const pageContent = useMemo(() => {
    switch (activePage) {
      case 'capture':
        return <Capture />
      case 'transcripts':
        return <Transcripts />
      case 'settings':
        return <Settings />
      default:
        return <Capture />
    }
  }, [activePage])
  
  return (
    <div className="app-shell bg-hero-gradient text-slate-100">
      <div className="app-surface min-h-screen flex flex-col">
        <Header
          activePage={activePage}
          onPageChange={setActivePage}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          updateInfo={updateInfo}
          dismissedVersion={dismissedVersion}
          onDismissUpdate={handleDismissUpdate}
          onDownloadUpdate={handleDownloadUpdate}
        />
        <DictationOverlay />
        <div className="flex flex-1 gap-6 px-4 pb-8 lg:px-8">
          <Sidebar 
            isOpen={sidebarOpen} 
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            activePage={activePage}
            onPageChange={setActivePage}
          />
          <main className="relative flex-1 overflow-hidden rounded-3xl glass-surface px-4 py-6 sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" aria-hidden />
            <div className="relative z-10 space-y-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activePage}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
                  className="space-y-8"
                >
                  {pageContent}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default Layout
