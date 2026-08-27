import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import FileViewer from './components/FileViewer'
import GitViewer from './components/git/GitViewer'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { applyTheme, watchTheme } from './theme'
import type { LogLevel } from '@shared/types'
import { formatLogArg } from '@shared/log-helpers'

// Every renderer (main window, Git viewer, FileViewer popup) applies the
// persisted theme before first paint, and re-applies it when the user toggles
// the theme in the main window (localStorage syncs across same-origin windows).
applyTheme()
watchTheme()

function patchConsoleLogging(): void {
  if (!window.api) return
  // Guard against HMR re-execution: every dev module reload re-runs this module,
  // which would otherwise re-wrap console.* and fire duplicate IPC writes per call.
  const g = console as unknown as { __meowSystemLogPatched?: boolean }
  if (g.__meowSystemLogPatched) return
  g.__meowSystemLogPatched = true
  const levelOf: Record<'log' | 'info' | 'warn' | 'error', LogLevel> = {
    log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR'
  }
  // Console methods are typed read-only, so assign through a looser record
  // (same pattern as the main process) while preserving the original `this`.
  const c = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const name of ['log', 'info', 'warn', 'error'] as const) {
    const original = c[name].bind(console)
    c[name] = (...args: unknown[]) => {
      original(...args)
      const message = args.map(formatLogArg).join(' ')
      void window.api.writeSystemLog(levelOf[name], message || name).catch(() => {})
    }
  }
}

patchConsoleLogging()

const rootEl = document.getElementById('root')!
const params = new URLSearchParams(window.location.search)
const fileParam = params.get('file')
const rootParam = params.get('root') ?? ''
const gitParam = params.get('git')

if (!window.api) {
  createRoot(rootEl).render(
    <div className="empty-state">
      <p className="subtitle">
        Preload is not loaded (window.api is missing). Close any old Electron windows still running,
        then run <code>npm run dev</code> again.
      </p>
    </div>
  )
} else if (fileParam) {
  // File-viewer popup window (opened by main via ?file=...&root=...).
  createRoot(rootEl).render(
    <React.StrictMode>
      <FileViewer path={fileParam} root={rootParam} />
    </React.StrictMode>
  )
} else if (gitParam) {
  // Git viewer popup window (opened by main via ?git=<projectPath>).
  createRoot(rootEl).render(
    <React.StrictMode>
      <GitViewer projectPath={gitParam} />
    </React.StrictMode>
  )
} else {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
