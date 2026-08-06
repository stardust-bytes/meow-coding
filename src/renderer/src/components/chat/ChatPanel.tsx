import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMode, ChatEvent, ChatMessage, Command, QuestionOption, SessionSummary, TodoItem, TodoStatus, ToolCallData } from '@shared/types'
import { appendStreamDelta } from '@shared/text'
import ChatInput from './ChatInput'
import ToolCallCard from './ToolCallCard'
import MarkdownText from './MarkdownText'
import SessionBar from './SessionBar'
import ModelPicker from './ModelPicker'

type FeedItem =
  | { kind: 'message'; id: string; role: ChatMessage['role']; text: string; reasoning?: string }
  | { kind: 'tool'; id: string; call: ToolCallData }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'subagent'; taskId: string; subagentType?: string; text: string; tools: string[]; state: 'running' | 'completed' | 'cancelled' | 'error' }

interface PendingPrompt {
  promptId: string
  promptType: 'permission' | 'question'
  call?: ToolCallData
  question?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

// Owns the per-message subtree so streamed deltas only re-render the message
// that changed, not the whole feed. Props are primitives, so React.memo works.
const FeedMessage = memo(function FeedMessage({ role, text, reasoning }: {
  role: ChatMessage['role']
  text: string
  reasoning?: string
}) {
  return (
    <div className={`chat-msg ${role}`}>
      {role === 'assistant' ? (
        <>
          {reasoning ? (
            <details className="chat-reasoning">
              <summary>Thinking</summary>
              <div className="chat-reasoning-text">{reasoning}</div>
            </details>
          ) : null}
          {text.trim() !== '' && <MarkdownText text={text} />}
        </>
      ) : <div className="chat-text">{text}</div>}
    </div>
  )
})

interface Props {
  agentId: string
  cwd: string
  mode?: AgentMode
  variant?: string
  onModeChange?: (mode: AgentMode) => void
  onVariantChange?: (variant: string | undefined) => void
}

function ChatPanel({ agentId, cwd, mode = 'build', variant, onModeChange, onVariantChange }: Props) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentMode, setCurrentMode] = useState<AgentMode>(mode)
  const [currentVariant, setCurrentVariant] = useState<string>(variant ?? '')
  const [availableVariants, setAvailableVariants] = useState<string[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  const [selectedAction, setSelectedAction] = useState(0)
  const [questionText, setQuestionText] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [customInput, setCustomInput] = useState(false)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [lastTokens, setLastTokens] = useState<{ input: number; output: number; total: number } | null>(null)
  const [lastCost, setLastCost] = useState(0)
  const [commands, setCommands] = useState<Command[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLDivElement>(null)
  const shouldJumpToEnd = useRef(true)
  // Stream deltas are accumulated per animation frame: one setItems per frame
  // bounds markdown parsing and feed re-renders, which otherwise saturate the
  // UI thread on every token and make typing in the input lag.
  const deltaBufRef = useRef<{ text: string; reasoning: string }>({ text: '', reasoning: '' })
  const rafRef = useRef<number | null>(null)
  const pinRafRef = useRef<number | null>(null)
  const prevLastIdRef = useRef<string | null>(null)
  const stuckRef = useRef(true)

  const refreshVariants = useCallback(() => {
    void window.api.getAgentVariants(agentId).then(list => {
      setAvailableVariants(list)
      setCurrentVariant(current => {
        if (current && !list.includes(current)) {
          onVariantChange?.(undefined)
          return ''
        }
        return current
      })
    })
  }, [agentId, onVariantChange])

  useEffect(() => { refreshVariants() }, [refreshVariants])

  useEffect(() => {
    const onModelChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string }>).detail
      if (detail?.agentId === agentId) refreshVariants()
    }
    window.addEventListener('meow:model-changed', onModelChanged)
    return () => window.removeEventListener('meow:model-changed', onModelChanged)
  }, [agentId, refreshVariants])

  useEffect(() => {
    if (pendingPrompt && pendingPrompt.promptType === 'permission') {
      promptRef.current?.focus()
    }
  }, [pendingPrompt])

  const loadTranscript = useCallback(() => {
    void window.api.listChatTranscript(agentId).then(items => {
      setItems(items.map(it => it.kind === 'message'
        ? { kind: 'message', id: it.message.id, role: it.message.role, text: it.message.text, reasoning: it.message.reasoning }
        : { kind: 'tool', id: it.tool.id, call: { ...it.tool } }
      ))
      shouldJumpToEnd.current = true
    })
  }, [agentId])

  const reloadSessions = useCallback(() => {
    void window.api.listSessions(agentId).then(list => {
      setSessions(list)
      setActiveSessionId(list[0]?.id ?? null)
    })
  }, [agentId])

  const loadTodos = useCallback(() => {
    void window.api.getChatTodos(agentId).then(setTodos)
  }, [agentId])

  const resetView = useCallback(() => {
    setItems([])
    setRunning(false)
    setPendingPrompt(null)
    setSelectedAction(0)
    setQuestionText('')
    setSelectedOptions([])
    setCustomInput(false)
    setLastTokens(null)
    setLastCost(0)
    setTodos([])
    loadTranscript()
    loadTodos()
  }, [loadTranscript, loadTodos])

  useEffect(() => {
    reloadSessions()
    loadTranscript()
    loadTodos()
    void window.api.listCommands(cwd).then(setCommands)
    const off = window.api.onChatEvent(e => applyEvent(e))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cwd])

  const onFeedScroll = useCallback(() => {
    const el = feedRef.current
    if (!el) return
    // Stay glued to the bottom unless the user scrolls up to read history.
    stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    // Reopening a session should land at the latest message instantly; only a
    // brand-new feed item gets a smooth scroll. Streaming deltas scroll
    // instantly: a smooth scroll per token animates on the UI thread and is a
    // big part of the input-lag jank.
    const el = endRef.current
    if (!el) return
    if (!stuckRef.current) return
    const last = items[items.length - 1]
    const lastId = last ? (last.kind === 'subagent' ? last.taskId : last.id) : null
    const isNewMessage = lastId !== prevLastIdRef.current
    prevLastIdRef.current = lastId
    if (shouldJumpToEnd.current) {
      shouldJumpToEnd.current = false
      const feed = feedRef.current
      if (!feed) return
      // content-visibility rows are laid out with estimated sizes on the first
      // paint and settle to their real heights over several frames, so a single
      // scrollIntoView can land short of the true bottom. Re-assert scrollTop
      // every frame for a while (or until the user scrolls up) to land at the
      // real end of the feed when opening a project/session.
      let frames = 0
      const pin = () => {
        if (!stuckRef.current) return
        feed.scrollTop = feed.scrollHeight
        if (frames++ < 60) pinRafRef.current = requestAnimationFrame(pin)
      }
      pin()
      pinRafRef.current = requestAnimationFrame(pin)
      return
    } else if (isNewMessage) {
      el.scrollIntoView({ behavior: 'smooth' })
    } else {
      el.scrollIntoView()
    }
  }, [items])

  // Applies deltas accumulated during one animation frame. Copy-on-write keeps
  // the updater pure and gives memoized rows a fresh object with new text.
  const flushDeltas = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const { text, reasoning } = deltaBufRef.current
    if (!text && !reasoning) return
    deltaBufRef.current = { text: '', reasoning: '' }
    setItems(prev => {
      const next = [...prev]
      if (text) {
        const last = next[next.length - 1]
        if (last && last.kind === 'message' && last.role === 'assistant') {
          next[next.length - 1] = { ...last, text: appendStreamDelta(last.text, text) }
        } else {
          next.push({ kind: 'message', id: 'a-' + Date.now(), role: 'assistant', text })
        }
      }
      if (reasoning) {
        const last = next[next.length - 1]
        if (last && last.kind === 'message' && last.role === 'assistant') {
          next[next.length - 1] = { ...last, reasoning: appendStreamDelta(last.reasoning ?? '', reasoning) }
        } else {
          next.push({ kind: 'message', id: 'a-' + Date.now(), role: 'assistant', text: '', reasoning })
        }
      }
      return next
    })
  }, [setItems])

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (pinRafRef.current != null) cancelAnimationFrame(pinRafRef.current)
  }, [])

  const applyEvent = useCallback((e: ChatEvent) => {
    if (e.agentId !== agentId) return
    if (e.type === 'subagent-event') {
      setItems(prev => {
        const idx = prev.findIndex(i => i.kind === 'subagent' && i.taskId === e.taskId)
        const base: FeedItem & { kind: 'subagent' } = idx >= 0
          ? prev[idx] as FeedItem & { kind: 'subagent' }
          : { kind: 'subagent', taskId: e.taskId, text: '', tools: [], state: 'running' }
        const next = { ...base }
        if (e.sub === 'delta' && e.text) next.text += e.text
        if (e.sub === 'tool' && e.tool && !next.tools.includes(e.tool)) next.tools = [...next.tools, e.tool]
        if (e.sub === 'start' && e.subagentType) next.subagentType = e.subagentType
        if (e.sub === 'done') next.state = e.state ?? 'completed'
        const arr = [...prev]
        if (idx >= 0) arr[idx] = next
        else arr.push(next)
        return arr
      })
      return
    }
    if (e.type === 'todo-updated') {
      setTodos(e.todos)
      return
    }
    if (e.type === 'compacted') {
      loadTranscript()
      return
    }
    if (e.type === 'done' || e.type === 'error') {
      flushDeltas()
      setRunning(false)
      setPendingPrompt(null)
      if (e.type === 'done') {
        if (e.tokens) setLastTokens(e.tokens)
        if (e.cost !== undefined) setLastCost(e.cost)
      }
      if (e.type === 'error') {
        setItems(prev => [...prev, { kind: 'error', id: 'err-' + Date.now(), text: e.message }])
      }
      return
    }
    if (e.type === 'prompt-request') {
      setPendingPrompt({
        promptId: e.promptId,
        promptType: e.kind,
        call: e.call,
        question: e.question,
        options: e.options,
        multiple: e.multiple,
        custom: e.custom
      })
      setSelectedAction(0)
      setSelectedOptions([])
      setCustomInput(false)
      setQuestionText('')
      setQuestionIndex(0)
      return
    }
    if (e.type === 'text-delta' || e.type === 'reasoning-delta') {
      const buf = deltaBufRef.current
      if (e.type === 'text-delta') buf.text += e.delta
      else buf.reasoning += e.delta
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          flushDeltas()
        })
      }
      return
    }
    setItems(prev => {
      const next = [...prev]
      if (e.type === 'tool-start') {
        next.push({ kind: 'tool', id: e.call.id, call: { ...e.call } })
      } else if (e.type === 'tool-result') {
        const idx = next.findIndex(i => i.kind === 'tool' && i.id === e.call.id)
        if (idx >= 0) next[idx] = { kind: 'tool', id: e.call.id, call: { ...e.call } }
      }
      return next
    })
  }, [agentId, flushDeltas])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setItems(prev => [...prev, { kind: 'message', id: 'u-' + Date.now(), role: 'user', text: trimmed }])
    setRunning(true)
    setLastTokens(null)
    setLastCost(0)
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
    if (m && commands.some(c => c.name === m[1])) {
      void window.api.runCommand(agentId, m[1], m[2] ? m[2].trim().split(/\s+/) : [])
    } else {
      void window.api.sendChat(agentId, trimmed)
    }
    reloadSessions()
  }, [agentId, commands, reloadSessions])

  const handleStop = useCallback(() => {
    void window.api.stopChat(agentId)
  }, [agentId])

  const handleCreateSession = useCallback(() => {
    void window.api.createSession(agentId).then(() => {
      resetView()
      reloadSessions()
    })
  }, [agentId, resetView, reloadSessions])

  const handleSelectSession = useCallback((sessionId: string) => {
    if (sessionId === activeSessionId) return
    void window.api.switchSession(agentId, sessionId).then(() => {
      resetView()
      reloadSessions()
    })
  }, [agentId, activeSessionId, resetView, reloadSessions])

  const handleDeleteSession = useCallback((sessionId: string) => {
    void window.api.deleteSession(agentId, sessionId).then(() => {
      resetView()
      reloadSessions()
    })
  }, [agentId, resetView, reloadSessions])

  const handleRenameSession = useCallback((sessionId: string, title: string) => {
    void window.api.renameSession(agentId, sessionId, title).then(() => {
      reloadSessions()
    })
  }, [agentId, reloadSessions])

  const handleUndo = useCallback(() => {
    void window.api.undoChat(agentId).then(ok => {
      if (ok) {
        loadTranscript()
        loadTodos()
      }
    })
  }, [agentId, loadTranscript, loadTodos])

  const handleRedo = useCallback(() => {
    void window.api.redoChat(agentId).then(ok => {
      if (ok) {
        loadTranscript()
        loadTodos()
      }
    })
  }, [agentId, loadTranscript, loadTodos])

  const respond = useCallback((promptId: string, allow: boolean, text?: string, always = false) => {
    void window.api.respondPrompt(agentId, promptId, { allow, text, always })
    setPendingPrompt(null)
    setSelectedAction(0)
    setQuestionText('')
    setSelectedOptions([])
    setCustomInput(false)
    setQuestionIndex(0)
  }, [agentId])

  const toggleOption = useCallback((label: string) => {
    setSelectedOptions(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label])
  }, [])

  const submitQuestion = useCallback(() => {
    if (!pendingPrompt || pendingPrompt.promptType !== 'question') return
    const parts = [...selectedOptions]
    if (customInput && questionText.trim()) parts.push(questionText.trim())
    const text = parts.join(', ')
    if (!text.trim()) return
    respond(pendingPrompt.promptId, true, text)
  }, [pendingPrompt, selectedOptions, customInput, questionText, respond])

  const startCustomInput = useCallback(() => {
    setCustomInput(v => !v)
    if (pendingPrompt && !pendingPrompt.multiple) setSelectedOptions([])
  }, [pendingPrompt])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingPrompt || pendingPrompt.promptType !== 'permission') return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      if (e.key === 'Tab') { e.preventDefault(); cycleAction(e.shiftKey ? -1 : 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); cycleAction(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleAction(-1) }
      else if (e.key === 'Enter') { e.preventDefault(); runSelected() }
      else if (e.key === '1') { e.preventDefault(); respond(pendingPrompt.promptId, true) }
      else if (e.key === '2') { e.preventDefault(); respond(pendingPrompt.promptId, true, undefined, true) }
      else if (e.key === '3') { e.preventDefault(); respond(pendingPrompt.promptId, false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingPrompt, cycleAction, runSelected, respond])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingPrompt || pendingPrompt.promptType !== 'question') return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      const optionCount = pendingPrompt.options?.length ?? 0
      const custom = pendingPrompt.custom !== false
      const submit = pendingPrompt.multiple && !customInput && optionCount > 0
      const total = optionCount + (custom ? 1 : 0) + (submit ? 1 : 0)
      if (total === 0) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        setQuestionIndex(prev => (prev + 1) % total)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setQuestionIndex(prev => (prev - 1 + total) % total)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (questionIndex < optionCount) {
          const opt = pendingPrompt.options![questionIndex]
          if (pendingPrompt.multiple) {
            toggleOption(opt.label)
          } else {
            respond(pendingPrompt.promptId, true, opt.label)
          }
        } else if (custom && questionIndex === optionCount) {
          startCustomInput()
        } else if (submit) {
          submitQuestion()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingPrompt, questionIndex, toggleOption, respond, startCustomInput])

  const onPanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    if (pendingPrompt && pendingPrompt.promptType === 'permission') return
    e.preventDefault()
    switchMode(currentMode === 'build' ? 'plan' : 'build')
  }, [pendingPrompt, currentMode, switchMode])

  const permissionActions = [
    { label: 'Allow', key: '1', run: () => pendingPrompt && respond(pendingPrompt.promptId, true) },
    { label: 'Always', key: '2', run: () => pendingPrompt && respond(pendingPrompt.promptId, true, undefined, true) },
    { label: 'Deny', key: '3', run: () => pendingPrompt && respond(pendingPrompt.promptId, false) }
  ]

  const todoMark = (status: TodoStatus): string => {
    switch (status) {
      case 'completed': return '✓'
      case 'in_progress': return '◐'
      case 'cancelled': return '✕'
      default: return '□'
    }
  }

  const doneCount = todos.filter(t => t.status === 'completed' || t.status === 'cancelled').length

  return (
    <div className="chat-panel" onKeyDown={onPanelKeyDown}>
      <SessionBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={handleCreateSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
      />
      <div className="chat-history-actions">
        <button className="btn small" title="undo last turn" onClick={handleUndo} disabled={running}>Undo</button>
        <button className="btn small" title="redo undone turn" onClick={handleRedo} disabled={running}>Redo</button>
      </div>
      {todos.length > 0 && (
        <div className="chat-todos">
          <div className="chat-todos-head">
            <span className="chat-todos-title">Tasks</span>
            <span className="chat-todos-count">{doneCount}/{todos.length}</span>
          </div>
          <ul className="chat-todos-list">
            {todos.map((t, i) => (
              <li key={i} className={`chat-todo status-${t.status}`}>
                <span className="chat-todo-mark">{todoMark(t.status)}</span>
                <span className="chat-todo-content">{t.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="chat-feed" ref={feedRef} onScroll={onFeedScroll}>
        {items.map(item => {
          if (item.kind === 'message') {
            if (item.role === 'assistant' && item.text.trim() === '' && !item.reasoning) return null
            return <FeedMessage key={item.id} role={item.role} text={item.text} reasoning={item.reasoning} />
          }
          if (item.kind === 'tool') {
            return <ToolCallCard key={item.id} call={item.call} />
          }
          if (item.kind === 'subagent') {
            return (
              <div key={item.taskId} className={`subagent ${item.state === 'running' ? 'running' : ''}`}>
                <div className="subagent-head">
                  <span className="subagent-name">sub-agent{item.subagentType ? ` (${item.subagentType})` : ''}</span>
                  <span className={`subagent-state state-${item.state}`}>{item.state}</span>
                </div>
                {item.tools.length > 0 && (
                  <div className="subagent-tools">
                    {item.tools.map(t => <code key={t}>{t}</code>)}
                  </div>
                )}
                {item.text && <div className="subagent-text">{item.text}</div>}
                {item.state === 'running' && <div className="subagent-running">…</div>}
              </div>
            )
          }
          return <div key={item.id} className="chat-error">{item.text}</div>
        })}
        {running && <div className="chat-running">Meow is working…</div>}
        {lastTokens && !running && (
          <div className="chat-tokens">
            tokens: {lastTokens.total} ({lastTokens.input} in / {lastTokens.output} out)
            {lastCost > 0 && <span className="chat-tokens-cost"> · ${lastCost.toFixed(4)}</span>}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-composer">
        {pendingPrompt && (
          <div className="chat-prompt" ref={pendingPrompt.promptType === 'permission' ? promptRef : undefined}
            tabIndex={pendingPrompt.promptType === 'permission' ? -1 : undefined}>
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
                <div className="chat-prompt-text">
                  {pendingPrompt.question}
                  {pendingPrompt.multiple && <span className="chat-prompt-multi-hint"> (select all that apply)</span>}
                </div>
                {pendingPrompt.options && pendingPrompt.options.length > 0 && (
                  <div className="chat-options">
                    {pendingPrompt.options.map((opt, i) => {
                      const selected = selectedOptions.includes(opt.label)
                      const mark = pendingPrompt.multiple ? (selected ? '[✓]' : '[ ]') : `${i + 1}.`
                      return (
                        <button
                          key={opt.label + i}
                          className={`chat-option ${selected ? 'selected' : ''} ${questionIndex === i ? 'focused' : ''}`}
                          onClick={() => (pendingPrompt.multiple
                            ? toggleOption(opt.label)
                            : respond(pendingPrompt.promptId, true, opt.label))}
                        >
                          <span className="chat-option-mark">{mark}</span>
                          <span className="chat-option-text">
                            <span className="chat-option-label">{opt.label}</span>
                            {opt.description && <span className="chat-option-desc">{opt.description}</span>}
                          </span>
                        </button>
                      )
                    })}
                    {pendingPrompt.custom !== false && (
                      <button
                        className={`chat-option custom ${customInput ? 'selected' : ''} ${questionIndex === (pendingPrompt.options?.length ?? 0) ? 'focused' : ''}`}
                        onClick={startCustomInput}
                      >
                        <span className="chat-option-mark">
                          {pendingPrompt.multiple
                            ? (customInput ? '[✓]' : '[ ]')
                            : `${(pendingPrompt.options?.length ?? 0) + 1}.`}
                        </span>
                        <span className="chat-option-text">
                          <span className="chat-option-label">Type your own answer</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
                {(customInput || !pendingPrompt.options?.length) && (
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
                          submitQuestion()
                        }
                      }}
                    />
                    <button onClick={submitQuestion}>Send</button>
                  </div>
                )}
                {!!pendingPrompt.options?.length && pendingPrompt.multiple && !customInput && (
                  <div className="chat-prompt-actions">
                    <button
                      className={questionIndex === (pendingPrompt.options?.length ?? 0) + (pendingPrompt.custom !== false ? 1 : 0) ? 'focused' : ''}
                      onClick={submitQuestion}
                      disabled={selectedOptions.length === 0}
                    >
                      Send
                    </button>
                  </div>
                )}
                {!!pendingPrompt.options?.length && !customInput && (
                  <div className="chat-prompt-hint">↑/↓ to navigate, Enter to select</div>
                )}
              </>
            )}
          </div>
        )}
        <div className="chat-mode">
          <span className="chat-mode-label">mode</span>
          <button
            className={`btn small mode-build ${currentMode === 'build' ? 'active' : ''}`}
            onClick={() => switchMode('build')}
          >
            build
          </button>
          <button
            className={`btn small mode-plan ${currentMode === 'plan' ? 'active' : ''}`}
            onClick={() => switchMode('plan')}
          >
            plan
          </button>
          {currentMode === 'plan' && <span className="chat-mode-hint">read-only — edits denied</span>}
          <div className="chat-mode-tools">
            <ModelPicker agentId={agentId} />
            {availableVariants.length > 0 && (
              <select
                className="input chat-variant-select"
                value={currentVariant}
                aria-label="model effort"
                onChange={e => {
                  const v = e.target.value
                  setCurrentVariant(v)
                  onVariantChange?.(v === '' ? undefined : v)
                }}
              >
                <option value="">Default</option>
                {availableVariants.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <ChatInput
          running={running}
          mode={currentMode}
          commands={commands}
          onSubmit={send}
          onStop={handleStop}
        />
      </div>
    </div>
  )
}

export default memo(ChatPanel)
