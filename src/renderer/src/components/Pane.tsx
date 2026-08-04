import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import XtermHost from './XtermHost'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'

interface Props {
  pane: PaneModel
  zoomed: boolean
  onZoom: () => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function Pane({
  pane, zoomed, onZoom, onRegisterTerminal, onUnregisterTerminal
}: Props) {
  const id = pane.agent.id
  const write = (data: string) => void window.api.writeInput(id, data)
  const native = pane.agent.kind === 'native'

  return (
    <div className={`pane ${zoomed ? 'zoomed' : ''}`}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        git={pane.git}
        zoomed={zoomed}
        native={native}
        onZoom={onZoom}
        onStop={() => native
          ? void window.api.stopChat(id)
          : void window.api.stopAgent(id)}
        onRestart={() => native
          ? void window.api.newChatSession(id)
          : void window.api.restartAgent(id)}
        onInject={text => void window.api.injectPrompt(id, text)}
        onOpenLog={() => void window.api.openLog(id)}
      />
      {native ? (
        <ChatPanel
          agentId={id}
          mode={pane.agent.mode ?? 'build'}
          onModeChange={m => void window.api.setAgentMode(id, m)}
        />
      ) : (
        <XtermHost
          agentId={id}
          onReady={term => onRegisterTerminal(id, term)}
          onDispose={onUnregisterTerminal}
          onInput={write}
          onResize={(cols, rows) => void window.api.resizePty(id, cols, rows)}
        />
      )}
    </div>
  )
}
