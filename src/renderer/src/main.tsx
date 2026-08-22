import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import FileViewer from './components/FileViewer'
import GitViewer from './components/git/GitViewer'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'

const rootEl = document.getElementById('root')!
const params = new URLSearchParams(window.location.search)
const fileParam = params.get('file')
const rootParam = params.get('root') ?? ''
const gitParam = params.get('git')

if (!window.api) {
  createRoot(rootEl).render(
    <div className="empty-state">
      <p className="subtitle">
        Preload chưa được nạp (window.api bị thiếu). Đóng mọi cửa sổ Electron cũ đang chạy, sau đó
        chạy lại <code>npm run dev</code>.
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
