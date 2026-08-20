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
      <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
      <rect x="0.5" y="2.5" width="7" height="7" />
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

function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1" y="2" width="14" height="12" rx="1" />
      <path d={open ? 'M11 2v12' : 'M11 5v7'} />
    </svg>
  )
}

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
}

export default function TitleBar({ panelOpen, onTogglePanel }: Props) {
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
      <div className="title-bar-right">
        <button
          className="title-bar-btn title-bar-panel-toggle"
          aria-label={panelOpen ? 'Hide Panel' : 'Show Panel'}
          title={panelOpen ? 'Hide Panel' : 'Show Panel'}
          onClick={onTogglePanel}
        >
          <PanelIcon open={panelOpen} />
        </button>
        {showCustomControls && (
          <div className="title-bar-controls" onDoubleClick={e => e.stopPropagation()}>
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
    </div>
  )
}
