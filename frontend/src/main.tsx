import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const webAppStartTime = performance.now()
const webAppStartTimestamp = new Date().toISOString()
console.log('[WEB_APP] phase=react_init_start timestamp=' + webAppStartTimestamp)

const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('[WEB_APP] phase=error error=root_element_not_found')
  throw new Error('Root element not found')
}

const rootCreateStartTime = performance.now()
const root = createRoot(rootElement)
const rootCreateElapsed = performance.now() - rootCreateStartTime
console.log('[WEB_APP] phase=react_root_create elapsed=' + rootCreateElapsed.toFixed(2) + 'ms')

const renderStartTime = performance.now()
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
const renderElapsed = performance.now() - renderStartTime
const totalInitElapsed = performance.now() - webAppStartTime
console.log('[WEB_APP] phase=react_render_complete elapsed=' + renderElapsed.toFixed(2) + 'ms')
console.log('[WEB_APP] phase=react_init_complete total_elapsed=' + totalInitElapsed.toFixed(2) + 'ms')