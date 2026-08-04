import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMode, ChatEvent, ChatMessage, ToolCallData } from '@shared/types'
import { appendStreamDelta } from '@shared/text'
import ChatInput from './ChatInput'
import ToolCallCard from './ToolCallCard'
import MarkdownText from './MarkdownText'

type FeedItem =
  | { kind: 'message'; id: string; role: ChatMessage['role']; text: string }
  | { kind: 'tool'; id: string; call: ToolCallData }
  | { kind: 'error'; id: string; text: string }

interface PendingPrompt {
  promptId: string
  promptType: 'permission' | 'question'
  call?: ToolCallData
  question?: string
}

interface Props {
  agentId: string
  mode?: AgentMode
  onModeChange?: (mode: AgentMode) => void
}

export default function ChatPanel({ agentId, mode = 'build', onModeChange }: Props) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentMode, setCurrentMode] = useState<AgentMode>(mode)
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  const [selectedAction, setSelectedAction] = useState(0)
  const [questionText, setQuestionText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.listChatTranscript(agentId).then(items => {
      setItems(items.map(it => it.kind === 'message'
        ? { kind: 'message', id: it.message.id, role: it.message.role, text: it.message.text }
        : { kind: 'tool', id: it.tool.id, call: { ...it.tool } }
      ))
    })
    const off = window.api.onChatEvent(e => applyEvent(e))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  const applyEvent = useCallback((e: ChatEvent) => {
    if (e.agentId !== agentId) return
    if (e.type === 'done' || e.type === 'error') {
      setRunning(false)
      if (e.type === 'error') {
        setItems(prev => [...prev, { kind: 'error', id: 'err-' + Date.now(), text: e.message }])
      }
      return
    }
    if (e.type === 'prompt-request') {
      setPendingPrompt({ promptId: e.promptId, promptType: e.kind, call: e.call, question: e.question })
      setSelectedAction(0)
      return
    }
    setItems(prev => {
      const next = [...prev]
      if (e.type === 'text-delta') {
        const last = next[next.length - 1]
        if (last && last.kind === 'message' && last.role === 'assistant') {
          last.text = appendStreamDelta(last.text, e.delta)
        } else {
          next.push({ kind: 'message', id: 'a-' + Date.now(), role: 'assistant', text: e.delta })
        }
      } else if (e.type === 'tool-start') {
        next.push({ kind: 'tool', id: e.call.id, call: { ...e.call } })
      } else if (e.type === 'tool-result') {
        const idx = next.findIndex(i => i.kind === 'tool' && i.id === e.call.id)
        if (idx >= 0) next[idx] = { kind: 'tool', id: e.call.id, call: { ...e.call } }
      }
      return next
    })
  }, [agentId])

  const send = useCallback((text: string) => {
    setItems(prev => [...prev, { kind: 'message', id: 'u-' + Date.now(), role: 'user', text }])
    setRunning(true)
    void window.api.sendChat(agentId, text)
  }, [agentId])

  const respond = useCallback((promptId: string, allow: boolean, text?: string, always = false) => {
    void window.api.respondPrompt(agentId, promptId, { allow, text, always })
    setPendingPrompt(null)
    setSelectedAction(0)
    setQuestionText('')
  }, [agentId])

  const switchMode = useCallback((m: AgentMode) => {
    setCurrentMode(m)
    onModeChange?.(m)
  }, [onModeChange])

  const cycleAction = useCallback((delta: number) => {
    setSelectedAction(prev => (prev + delta + 3) % 3)
  }, [])

  const runSelected = useCallback(() => {
    if (!pendingPrompt || pendingPrompt.promptType !== 'permission') return
    if (selectedAction === 0) respond(pendingPrompt.promptId, true)
    else if (selectedAction === 1) respond(pendingPrompt.promptId, true, undefined, true)
    else respond(pendingPrompt.promptId, false)
  }, [pendingPrompt, selectedAction, respond])

  const onPanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

    if (e.key === 'Tab') {
      e.preventDefault()
      if (pendingPrompt && pendingPrompt.promptType === 'permission') cycleAction(e.shiftKey ? -1 : 1)
      else switchMode(currentMode === 'build' ? 'plan' : 'build')
      return
    }
    if (inField || !pendingPrompt || pendingPrompt.promptType !== 'permission') return
    if (e.key === 'ArrowRight') { e.preventDefault(); cycleAction(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleAction(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); runSelected() }
    else if (e.key === '1') { e.preventDefault(); respond(pendingPrompt.promptId, true) }
    else if (e.key === '2') { e.preventDefault(); respond(pendingPrompt.promptId, true, undefined, true) }
    else if (e.key === '3') { e.preventDefault(); respond(pendingPrompt.promptId, false) }
  }, [pendingPrompt, currentMode, cycleAction, switchMode, runSelected, respond])

  const permissionActions = [
    { label: 'Allow', key: '1', run: () => pendingPrompt && respond(pendingPrompt.promptId, true) },
    { label: 'Always', key: '2', run: () => pendingPrompt && respond(pendingPrompt.promptId, true, undefined, true) },
    { label: 'Deny', key: '3', run: () => pendingPrompt && respond(pendingPrompt.promptId, false) }
  ]

  return (
    <div className="chat-panel" onKeyDown={onPanelKeyDown}>
      <div className="chat-feed">
        {items.map(item => {
          if (item.kind === 'message') {
            return (
              <div key={item.id} className={`chat-msg ${item.role}`}>
                {item.role === 'assistant'
                  ? <MarkdownText text={item.text} />
                  : <div className="chat-text">{item.text}</div>}
              </div>
            )
          }
          if (item.kind === 'tool') {
            return <ToolCallCard key={item.id} call={item.call} />
          }
          return <div key={item.id} className="chat-error">{item.text}</div>
        })}
        {running && <div className="chat-running">Meow is working…</div>}
        <div ref={endRef} />
      </div>
      <div className="chat-composer">
        {pendingPrompt && (
          <div className="chat-prompt">
            {pendingPrompt.promptType === 'permission' ? (
              <>
                <div className="chat-prompt-text">
                  Meow wants to run <code>{pendingPrompt.call?.tool}</code>:
                </div>
                <div className="chat-prompt-actions">
                  {permissionActions.map((a, i) => (
                    <button
                      key={a.label}
                      className={[
                        i === 0 ? 'allow' : '',
                        i === 1 ? 'always' : '',
                        selectedAction === i ? 'selected' : ''
                      ].filter(Boolean).join(' ')}
                      onClick={a.run}
                    >
                      {a.label} <kbd>{a.key}</kbd>
                    </button>
                  ))}
                </div>
                <div className="chat-prompt-hint">←/→ or Tab to select, Enter to confirm</div>
              </>
            ) : (
              <>
                <div className="chat-prompt-text">{pendingPrompt.question}</div>
                <div className="chat-prompt-actions">
                  <input
                    autoFocus
                    className="chat-prompt-input"
                    value={questionText}
                    placeholder="Answer..."
                    onChange={e => setQuestionText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        respond(pendingPrompt.promptId, true, questionText)
                      }
                    }}
                  />
                  <button onClick={() => respond(pendingPrompt.promptId, true, questionText)}>Send</button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="chat-mode">
          <span className="chat-mode-label">mode</span>
          <button
            className={`btn small ${currentMode === 'build' ? 'active' : ''}`}
            onClick={() => switchMode('build')}
          >
            build
          </button>
          <button
            className={`btn small ${currentMode === 'plan' ? 'active' : ''}`}
            onClick={() => switchMode('plan')}
          >
            plan
          </button>
          {currentMode === 'plan' && <span className="chat-mode-hint">read-only — edits denied</span>}
        </div>
        <ChatInput
          running={running}
          onSubmit={send}
          onStop={() => void window.api.stopChat(agentId)}
        />
      </div>
    </div>
  )
}
