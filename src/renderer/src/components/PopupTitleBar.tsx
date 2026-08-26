import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

function MinimizeIcon() { return <Minus size={10} aria-hidden="true" /> }
function MaximizeIcon() { return <Square size={10} aria-hidden="true" /> }
function RestoreIcon() { return <Copy size={10} aria-hidden="true" /> }
function CloseIcon() { return <X size={10} aria-hidden="true" /> }

interface Props {
  title: string
}

// Custom title bar for the FileViewer/GitViewer popups so they match the main
// window: hidden native frame (Windows/macOS draw the overlay min/max/close;
// Linux gets frame:false so we draw our own). The bar is the drag region.
export default function PopupTitleBar({ title }: Props) {
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
        <span className="title-bar-title">{title}</span>
      </div>
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
  )
}
