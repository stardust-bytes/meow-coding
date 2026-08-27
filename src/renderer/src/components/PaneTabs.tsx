import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'

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
                onClick={e => { e.stopPropagation(); onRemove(pane.agent.id) }}
              >✕</button>
            ) : null}
          </div>
        ))}
      </div>
      {active ? (
        <Pane
          key={active.agent.id}
          pane={active}
          background={Boolean(backgrounds[active.agent.id])}
          isTerminal={isTerminal(active.agent.id)}
          active
          onFocus={() => setActiveId(active.agent.id)}
          onRemove={() => onRemove(active.agent.id)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      ) : null}
    </div>
  )
}
