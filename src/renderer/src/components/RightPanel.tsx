import { useCallback, useRef } from 'react'
import { FileText, FolderTree } from 'lucide-react'
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
  return <FolderTree size={16} aria-hidden="true" />
}

function ArtifactIcon() {
  return <FileText size={16} aria-hidden="true" />
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

  return (
    <div className="right-panel" style={{ width }}>
      <div className="right-panel-resizer" onMouseDown={startDrag} />
      <div className="right-panel-content">
        {/* Keep both views mounted so the tree keeps its expanded state (and
            scroll position) when the user switches tabs. */}
        <div className={`right-panel-view${tab === 'tree' ? '' : ' hidden'}`}>
          <RightPanelTree root={root} />
        </div>
        <div className={`right-panel-view${tab === 'artifacts' ? '' : ' hidden'}`}>
          <RightPanelArtifacts root={root} artifacts={artifacts} onClear={onClearArtifacts} />
        </div>
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
