import { useEffect, useState } from 'react'
import logoMark from '../assets/logo-mark.png'

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <line x1="0" y1="5" x2="10" y2="5" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="2.5" y="0.5" width="7" height="7" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="#252526" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" />
      <line x1="10" y1="0" x2="0" y2="10" />
    </svg>
  )
}

export default function TitleBar() {
  const platform = window.api.platform
  const showCustomControls = platform === 'linux'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!showCustomControls) return
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximizedChange(e => setMaximized(e.maximized))
  }, [showCustomControls])

  return (
    <div
      className={`title-bar title-bar-${platform}`}
      onDoubleClick={() => { if (showCustomControls) void window.api.toggleMaximizeWindow() }}
    >
      <div className="title-bar-brand">
        <img src={logoMark} className="title-bar-logo" alt="" />
        <span className="title-bar-title">Meow Coding</span>
      </div>
      {showCustomControls && (
        <div className="title-bar-controls">
          <button className="title-bar-btn" aria-label="Minimize" onClick={() => void window.api.minimizeWindow()}>
            <MinimizeIcon />
          </button>
          <button
            className="title-bar-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.api.toggleMaximizeWindow()}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button className="title-bar-btn title-bar-btn-close" aria-label="Close" onClick={() => void window.api.closeWindow()}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}
