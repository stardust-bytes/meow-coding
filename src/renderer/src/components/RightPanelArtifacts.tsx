import { useState } from 'react'
import type { ArtifactEntry } from '@shared/types'
import FileContextMenu, { type FileMenuState } from './FileContextMenu'

interface Props {
  root: string | null
  artifacts: ArtifactEntry[]
  onClear: () => void
}

function CreateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="artifact-icon create">
      <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1a5 5 0 1 1 0 10A5 5 0 0 1 8 3z" />
      <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="artifact-icon edit">
      <path d="M11.5 1.5l3 3L6 13l-3.5.5L3 10l8.5-8.5z" />
    </svg>
  )
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function RightPanelArtifacts({ root, artifacts, onClear }: Props) {
  const [menu, setMenu] = useState<FileMenuState | null>(null)

  // Group by agent, preserving first-seen order.
  const groups: { agentId: string; agentName: string; entries: ArtifactEntry[] }[] = []
  const index = new Map<string, typeof groups[number]>()
  for (const entry of artifacts) {
    let group = index.get(entry.agentId)
    if (!group) {
      group = { agentId: entry.agentId, agentName: entry.agentName || entry.agentId, entries: [] }
      index.set(entry.agentId, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  return (
    <div className="right-panel-body">
      <div className="right-panel-header">
        <span className="right-panel-title">Artifacts</span>
        {artifacts.length > 0 && (
          <button className="btn small" title="Clear artifacts" onClick={onClear}>Clear</button>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="right-panel-empty">No artifacts yet</div>
      ) : (
        <div className="artifacts">
          {groups.map(group => (
            <div key={group.agentId} className="artifact-group">
              <div className="artifact-group-header">
                <span className="artifact-agent">{group.agentName}</span>
                <span className="artifact-badge">{group.entries.length}</span>
              </div>
              {group.entries.map(entry => (
                <div
                  key={entry.id}
                  className="artifact-row"
                  onClick={() => root && void window.api.openFile({ path: entry.absPath, root })}
                  onContextMenu={e => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, absPath: entry.absPath })
                  }}
                >
                  {entry.kind === 'create' ? <CreateIcon /> : <EditIcon />}
                  <span className="artifact-path" title={entry.path}>{entry.path}</span>
                  <span className="artifact-time">{relativeTime(entry.ts)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <FileContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
