import { useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneGrid({ panes, onRegisterTerminal, onUnregisterTerminal }: Props) {
  const [zoomedId, setZoomedId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const zoomed = panes.find(p => p.agent.id === zoomedId) ?? null

  if (zoomed) {
    return (
      <div className="pane-zoom">
        <Pane
          pane={zoomed}
          zoomed
          onZoom={() => setZoomedId(null)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      </div>
    )
  }

  const columns = panes.length > 1 ? 2 : 1

  return (
    <div className="pane-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {panes.map(pane => (
        <Pane
          key={pane.agent.id}
          pane={pane}
          zoomed={false}
          onZoom={() => setZoomedId(pane.agent.id)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      ))}
    </div>
  )
}
