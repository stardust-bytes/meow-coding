import { useCallback, useEffect, useRef } from 'react'
import type { ArtifactEntry } from '@shared/types'
import RightPanelTree from './RightPanelTree'
import RightPanelArtifacts from './RightPanelArtifacts'

interface Props {
  root: string | null
  tab: 'tree' | 'artifacts'
  width: number
  artifacts: ArtifactEntry[]
  onTabChange: (tab: 'tree' | 'artifacts') => void
  onWidthChange: (width: number) => void
  onClearArtifacts: () => void
}

function FolderTreeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M1.5 3.5h4l1.5 2h7.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function ArtifactIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M3 1.5h6.5L13 5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  )
}

export default function RightPanel({
  root, tab, width, artifacts, onTabChange, onWidthChange, onClearArtifacts
}: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(600, Math.max(240, dragRef.current.startWidth + delta))
      onWidthChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  // Refresh the width used by the drag closure if it changes mid-drag.
  useEffect(() => {
    if (dragRef.current) dragRef.current.startWidth = width
  }, [width])

  return (
    <div className="right-panel" style={{ width }}>
      <div className="right-panel-resizer" onMouseDown={startDrag} />
      <div className="right-panel-content">
        {tab === 'tree' ? (
          <RightPanelTree root={root} />
        ) : (
          <RightPanelArtifacts root={root} artifacts={artifacts} onClear={onClearArtifacts} />
        )}
      </div>
      <div className="right-panel-tabs" role="tablist" aria-label="Right panel tabs">
        <button
          className={`right-panel-tab${tab === 'tree' ? ' active' : ''}`}
          title="Directory Tree"
          aria-label="Directory Tree"
          onClick={() => onTabChange('tree')}
        >
          <FolderTreeIcon />
        </button>
        <button
          className={`right-panel-tab${tab === 'artifacts' ? ' active' : ''}`}
          title="Artifacts"
          aria-label="Artifacts"
          onClick={() => onTabChange('artifacts')}
        >
          <ArtifactIcon />
        </button>
      </div>
    </div>
  )
}
