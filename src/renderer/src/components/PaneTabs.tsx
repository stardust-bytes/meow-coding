import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  panes: PaneModel[]
  backgrounds: Record<string, boolean>
  isTerminal: (id: string) => boolean
  onRemove: (agentId: string) => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneTabs({ panes, backgrounds, isTerminal, onRemove, onRegisterTerminal, onUnregisterTerminal }: Props) {
  const [activeId, setActiveId] = useState<string | null>(panes[0]?.agent.id ?? null)
  const [pendingClose, setPendingClose] = useState<string | null>(null)

  // Keep active tab valid as the pane list changes (add/remove).
  useEffect(() => {
    if (panes.length === 0) { setActiveId(null); return }
    if (activeId && panes.some(p => p.agent.id === activeId)) return
    setActiveId(panes[0].agent.id)
  }, [panes, activeId])

  const active = panes.find(p => p.agent.id === activeId) ?? panes[0]

  return (
    <div className="agent-tabs-view">
      <div className="agent-tab-bar" role="tablist">
        {panes.map(pane => (
          <div
            key={pane.agent.id}
            role="tab"
            aria-selected={pane.agent.id === (active?.agent.id ?? null)}
            className={`agent-tab ${pane.agent.id === (active?.agent.id ?? null) ? 'active' : ''}`}
            onClick={() => setActiveId(pane.agent.id)}
          >
            <span className={`status-dot status-${pane.state.status}`} />
            <span className="agent-tab-name">{pane.agent.name}</span>
            {panes.length > 1 ? (
              <button
                className="agent-tab-close"
                aria-label={`Close ${pane.agent.name}`}
                onClick={e => { e.stopPropagation(); setPendingClose(pane.agent.id) }}
              >✕</button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="agent-pane-container">
        {panes.map(pane => (
          <Pane
            key={pane.agent.id}
            pane={pane}
            background={Boolean(backgrounds[pane.agent.id])}
            isTerminal={isTerminal(pane.agent.id)}
            active={pane.agent.id === active?.agent.id}
            onFocus={() => setActiveId(pane.agent.id)}
            onRemove={() => onRemove(pane.agent.id)}
            onRegisterTerminal={onRegisterTerminal}
            onUnregisterTerminal={onUnregisterTerminal}
          />
        ))}
      </div>
      {pendingClose && (() => {
        const pane = panes.find(p => p.agent.id === pendingClose)
        if (!pane) return null
        const isTerm = isTerminal(pane.agent.id)
        return (
          <ConfirmDialog
            title={isTerm ? 'Close terminal' : 'Delete agent'}
            message={isTerm
              ? `Close terminal "${pane.agent.name}"?`
              : `Delete agent "${pane.agent.name}"? This cannot be undone.`}
            confirmLabel={isTerm ? 'Close' : 'Delete'}
            onConfirm={() => { onRemove(pane.agent.id); setPendingClose(null) }}
            onCancel={() => setPendingClose(null)}
          />
        )
      })()}
    </div>
  )
}
