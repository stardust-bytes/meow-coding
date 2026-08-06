import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  backgrounds: Record<string, boolean>
  onRemove: (agentId: string) => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneGrid({ panes, backgrounds, onRemove, onRegisterTerminal, onUnregisterTerminal }: Props) {
  const [zoomedId, setZoomedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zoomedId) setZoomedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomedId])

  const columns = panes.length > 1 ? 2 : 1
  const activeId = zoomedId ?? focusedId ?? panes[0]?.agent.id ?? null

  return (
    <div
      className={`pane-grid ${zoomedId ? 'zoom-mode' : ''}`}
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {panes.map(pane => (
        <Pane
          key={pane.agent.id}
          pane={pane}
          background={Boolean(backgrounds[pane.agent.id])}
          zoomed={pane.agent.id === zoomedId}
          active={pane.agent.id === activeId}
          onFocus={() => setFocusedId(pane.agent.id)}
          onZoom={() => setZoomedId(zoomedId ? null : pane.agent.id)}
          onRemove={() => onRemove(pane.agent.id)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      ))}
    </div>
  )
}
