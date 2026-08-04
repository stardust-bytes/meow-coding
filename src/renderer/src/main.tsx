import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const rootEl = document.getElementById('root')!

if (!window.api) {
  createRoot(rootEl).render(
    <div className="empty-state">
      <p className="subtitle">
        Preload chưa được nạp (window.api bị thiếu). Đóng mọi cửa sổ Electron cũ đang chạy, sau đó
        chạy lại <code>npm run dev</code>.
      </p>
    </div>
  )
} else {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
