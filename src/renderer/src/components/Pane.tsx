import { useCallback, useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import XtermHost from './XtermHost'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'
import TracePanel from './trace/TracePanel'

interface Props {
  pane: PaneModel
  background: boolean
  isTerminal: boolean
  zoomed: boolean
  active: boolean
  onFocus: () => void
  onZoom: () => void
  onRemove: () => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function Pane({
  pane, background, isTerminal, zoomed, active, onFocus, onZoom, onRemove, onRegisterTerminal, onUnregisterTerminal
}: Props) {
  const id = pane.agent.id
  const write = (data: string) => void window.api.writeInput(id, data)
  const native = pane.agent.kind === 'native'
  const [tab, setTab] = useState<'chat' | 'trace'>('chat')
  useEffect(() => setTab('chat'), [id])
  // Stable callbacks so App-level re-renders (git poll, agent state) don't
  // cascade past the memoized ChatPanel into the chat feed.
  const handleStop = useCallback(() => {
    if (isTerminal) void window.api.closeTerminal(id)
    else if (native) void window.api.stopChat(id)
    else void window.api.stopAgent(id)
  }, [id, native, isTerminal])
  const handleRestart = useCallback(() => {
    if (native) void window.api.newChatSession(id)
    else void window.api.restartAgent(id)
  }, [id, native])
  const handleInject = useCallback((text: string) => void window.api.injectPrompt(id, text), [id])
  const handleOpenLog = useCallback(() => void window.api.openLog(id), [id])
  const handleModeChange = useCallback((m: 'build' | 'plan') => void window.api.setAgentMode(id, m), [id])
  const handleVariantChange = useCallback((v: string | undefined) => void window.api.setAgentVariant(id, v ?? null), [id])
  const handleToggleBackground = useCallback(() => {
    void window.api.setAgentBackground(id, !background)
  }, [id, background])

  return (
    <div className={`pane ${zoomed ? 'zoomed' : ''} ${background ? 'backgrounded' : ''}`} onClick={onFocus}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        git={pane.git}
        zoomed={zoomed}
        background={background}
        native={native}
        activeTab={tab}
        onTabChange={setTab}
        isTerminal={isTerminal}
        active={active}
        onZoom={onZoom}
        onStop={handleStop}
        onRestart={handleRestart}
        onInject={handleInject}
        onOpenLog={handleOpenLog}
        onToggleBackground={handleToggleBackground}
        onRemove={onRemove}
      />
      {background ? (
        <button className="pane-background-badge" onClick={() => void window.api.setAgentBackground(id, false)}>
          <span className="pane-background-name">{pane.agent.name}</span>
          <span className="pane-background-status">{pane.state.status}</span>
          <span className="pane-background-hint">click to open</span>
        </button>
      ) : null}
      <div className="pane-body">
        {native ? (
          tab === 'trace' ? (
            <TracePanel agentId={id} />
          ) : (
            <ChatPanel
              agentId={id}
              cwd={pane.agent.cwd}
              mode={pane.agent.mode ?? 'build'}
              variant={pane.agent.variant}
              onModeChange={handleModeChange}
              onVariantChange={handleVariantChange}
            />
          )
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
    </div>
  )
}
