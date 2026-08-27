import { useState } from 'react'
import type { PaneModel } from '../App'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  panes: PaneModel[]
  backgrounds: Record<string, boolean>
  onOpen: (agentId: string) => void
  onStop: (agentId: string) => void
  onRemove: (agentId: string) => void
}

export default function BackgroundPanel({ panes, backgrounds, onOpen, onStop, onRemove }: Props) {
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const items = panes.filter(p => backgrounds[p.agent.id])
  if (items.length === 0) return null

  const target = pendingRemove ? items.find(p => p.agent.id === pendingRemove) : null

  return (
    <div className="background-panel">
      <div className="background-panel-head">
        <span className="background-panel-title">Background</span>
      </div>
      {items.map(p => (
        <div key={p.agent.id} className={`background-item alert-${p.state.alert}`}>
          <span className={`status-dot status-${p.state.status}`} />
          <span className="background-name">{p.agent.name}</span>
          <span className="background-status">{p.state.status}</span>
          <span className="background-actions">
            <button className="btn ghost small" onClick={() => onOpen(p.agent.id)}>Open</button>
            <button className="btn ghost small" onClick={() => onStop(p.agent.id)}>Stop</button>
            <button className="btn ghost small danger" onClick={() => setPendingRemove(p.agent.id)}>Delete</button>
          </span>
        </div>
      ))}
      {target && (
        <ConfirmDialog
          title="Delete agent"
          message={`Delete agent "${target.agent.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { onRemove(target.agent.id); setPendingRemove(null) }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}
