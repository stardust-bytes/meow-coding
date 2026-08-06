import { useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import XtermHost from './XtermHost'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'

interface Props {
  pane: PaneModel
  zoomed: boolean
  active: boolean
  onFocus: () => void
  onZoom: () => void
  onRemove: () => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function Pane({
  pane, zoomed, active, onFocus, onZoom, onRemove, onRegisterTerminal, onUnregisterTerminal
}: Props) {
  const id = pane.agent.id
  const write = (data: string) => void window.api.writeInput(id, data)
  const native = pane.agent.kind === 'native'
  // Stable callbacks so App-level re-renders (git poll, agent state) don't
  // cascade past the memoized ChatPanel into the chat feed.
  const handleStop = useCallback(() => {
    if (native) void window.api.stopChat(id)
    else void window.api.stopAgent(id)
  }, [id, native])
  const handleRestart = useCallback(() => {
    if (native) void window.api.newChatSession(id)
    else void window.api.restartAgent(id)
  }, [id, native])
  const handleInject = useCallback((text: string) => void window.api.injectPrompt(id, text), [id])
  const handleOpenLog = useCallback(() => void window.api.openLog(id), [id])
  const handleModeChange = useCallback((m: 'build' | 'plan') => void window.api.setAgentMode(id, m), [id])
  const handleVariantChange = useCallback((v: string | undefined) => void window.api.setAgentVariant(id, v ?? null), [id])

  return (
    <div className={`pane ${zoomed ? 'zoomed' : ''}`} onClick={onFocus}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        git={pane.git}
        zoomed={zoomed}
        native={native}
        active={active}
        onZoom={onZoom}
        onStop={handleStop}
        onRestart={handleRestart}
        onInject={handleInject}
        onOpenLog={handleOpenLog}
        onRemove={onRemove}
      />
      {native ? (
        <ChatPanel
          agentId={id}
          cwd={pane.agent.cwd}
          mode={pane.agent.mode ?? 'build'}
          variant={pane.agent.variant}
          onModeChange={handleModeChange}
          onVariantChange={handleVariantChange}
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
