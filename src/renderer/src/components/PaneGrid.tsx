import type { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'

interface Props {
  panes: PaneModel[]
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneGrid({ panes }: Props) {
  return <div className="pane-grid">PaneGrid placeholder ({panes.length} panes)</div>
}
