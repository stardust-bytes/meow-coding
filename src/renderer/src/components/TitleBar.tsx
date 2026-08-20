import { useEffect, useState } from 'react'
import { Copy, Minus, PanelRight, PanelRightClose, Square, X } from 'lucide-react'
import logoMark from '../assets/logo-mark.png'

function MinimizeIcon() {
  return <Minus size={10} aria-hidden="true" />
}

function MaximizeIcon() {
  return <Square size={10} aria-hidden="true" />
}

function RestoreIcon() {
  return <Copy size={10} aria-hidden="true" />
}

function CloseIcon() {
  return <X size={10} aria-hidden="true" />
}

function PanelIcon({ open }: { open: boolean }) {
  return open ? <PanelRight size={14} aria-hidden="true" /> : <PanelRightClose size={14} aria-hidden="true" />
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
