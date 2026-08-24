import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AgentMode, ChatEvent, ChatMessage, Command, ImageAttachment, QuestionOption, QueuedMessage, SessionSummary, TodoItem, TodoStatus, ToolCallData } from '@shared/types'
import { appendStreamDelta } from '@shared/text'
import { contextTokens } from '@shared/usage'
import ChatInput from './ChatInput'
import { useChatScroll } from './useChatScroll'
import { buildQuestionAnswer } from './questionAnswer'
import ToolCallCard from './ToolCallCard'
import MarkdownText from './MarkdownText'
import SessionBar from './SessionBar'
import ModelPicker from './ModelPicker'
import VariantPicker from './VariantPicker'
import ContextFooter from './ContextFooter'

type FeedItem =
  | { kind: 'message'; id: string; role: ChatMessage['role']; text: string; reasoning?: string; images?: ImageAttachment[] }
  | { kind: 'tool'; id: string; call: ToolCallData }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'compaction'; id: string; running?: boolean; failed?: boolean }
  | { kind: 'subagent'; taskId: string; subagentType?: string; text: string; reasoning?: string; result?: string; background?: boolean; tools: string[]; state: 'running' | 'completed' | 'cancelled' | 'error' }

interface PendingPrompt {
  promptId: string
  promptType: 'permission' | 'question'
  call?: ToolCallData
  question?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

// Splits user text on @path tokens and highlights them, matching the main-side
// @reference syntax (bare or quoted forms).
const MENTION_SPLIT_RE = /(@[\w./\\-]+)/g
// Leading slash command token ("/init", "/review", ...).
const SLASH_RE = /^(\/[\w-]+)/

function MentionText({ text, commands }: { text: string; commands: Command[] }) {
  const m = SLASH_RE.exec(text)
  const slash = m && commands.some(c => c.name === m[1].slice(1)) ? m[1] : null
  const rest = slash !== null ? text.slice(slash.length) : text
  const parts = rest.split(MENTION_SPLIT_RE)
  return (
    <div className="chat-text">
      {slash && <span className="chat-slash">{slash}</span>}
      {parts.map((part, i) =>
        part.startsWith('@')
          ? <span key={i} className="chat-mention">{part}</span>
          : part
      )}
    </div>
  )
}

// Owns the per-message subtree so streamed deltas only re-render the message
// that changed, not the whole feed. Props are primitives or stable state
// references (commands), so React.memo works.
const FeedMessage = memo(function FeedMessage({ role, text, reasoning, images, commands, messageId, onOpenImage, onOpenFile }: {
  role: ChatMessage['role']
  text: string
  reasoning?: string
  images?: ImageAttachment[]
  commands: Command[]
  messageId: string
  onOpenImage?: (dataUrl: string) => void
  onOpenFile?: (path: string) => void
}) {
  return (
    <div className={`chat-msg ${role}`} data-chat-message-id={messageId}>
      {role === 'assistant' ? (
        <>
          {reasoning ? (
            <details className="chat-reasoning">
              <summary>Thinking</summary>
              <div className="chat-reasoning-text">{reasoning}</div>
            </details>
          ) : null}
          {text.trim() !== '' && <MarkdownText text={text} onOpenFile={onOpenFile} />}
        </>
      ) : (
        <>
          {images && images.length > 0 && (
            <div className="chat-msg-images">
              {images.map(img => (
                <img
                  key={img.id}
                  src={img.dataUrl}
                  alt={img.name}
                  className="chat-thumb"
                  onClick={() => onOpenImage?.(img.dataUrl)}
                />
              ))}
            </div>
          )}
          {text.trim() !== '' && <MentionText text={text} commands={commands} />}
        </>
      )}
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
  // Keep local state in sync with the authoritative main-process config pushed
  // via EventAgentConfig; otherwise a remount reverts to the pre-change mode.
  useEffect(() => setCurrentMode(mode), [mode])
  useEffect(() => setCurrentVariant(variant ?? ''), [variant])
  const [availableVariants, setAvailableVariants] = useState<string[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  const [selectedAction, setSelectedAction] = useState(0)
  const [questionText, setQuestionText] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [customInput, setCustomInput] = useState(false)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [contextUsed, setContextUsed] = useState<number | null>(null)
  const [sessionCost, setSessionCost] = useState(0)
  const [sessionTokens, setSessionTokens] = useState<{ input: number; output: number } | null>(null)
  const [contextLimit, setContextLimit] = useState<number | null>(null)
  const [compactThreshold, setCompactThreshold] = useState<number | null>(null)
  const [commands, setCommands] = useState<Command[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todosCollapsed, setTodosCollapsed] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const queueRef = useRef<QueuedMessage[]>([])
  const [editTarget, setEditTarget] = useState<QueuedMessage | null>(null)
  const [liveTaskId, setLiveTaskId] = useState<string | null>(null)
  const promptRef = useRef<HTMLDivElement>(null)
  const scroll = useChatScroll()
  // Stream deltas are accumulated per animation frame: one setItems per frame
  // bounds markdown parsing and feed re-renders, which otherwise saturate the
  // UI thread on every token and make typing in the input lag.
  const deltaBufRef = useRef<{ text: string; reasoning: string }>({ text: '', reasoning: '' })
  const rafRef = useRef<number | null>(null)

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

  const loadContextInfo = useCallback(() => {
    void window.api.getContextInfo(agentId).then(info => {
      setContextLimit(info.limit)
      setCompactThreshold(info.compactThreshold)
      setSessionCost(info.sessionCost)
    })
  }, [agentId])

  useEffect(() => { refreshVariants(); loadContextInfo() }, [refreshVariants, loadContextInfo])

  useEffect(() => {
    const onModelChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string }>).detail
      if (detail?.agentId === agentId) { refreshVariants(); loadContextInfo() }
    }
    window.addEventListener('meow:model-changed', onModelChanged)
    return () => window.removeEventListener('meow:model-changed', onModelChanged)
  }, [agentId, refreshVariants, loadContextInfo])

  useEffect(() => {
    if (pendingPrompt && pendingPrompt.promptType === 'permission') {
      promptRef.current?.focus()
    }
  }, [pendingPrompt])

  const loadTranscript = useCallback(() => {
    void window.api.listChatTranscript(agentId).then(items => {
      setItems(items.map(it => it.kind === 'message'
        ? {
            kind: 'message', id: it.message.id, role: it.message.role,
            text: it.message.displayText ?? it.message.text,
            reasoning: it.message.reasoning, images: it.message.images
          }
        : { kind: 'tool', id: it.tool.id, call: { ...it.tool } }
      ))
      // Mức chiếm dụng context = token của assistant message cuối cùng có output,
      // giống cách opencode chọn (subagent-footer.tsx:35).
      let used: number | null = null
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.kind !== 'message') continue
        const t = it.message.tokens
        if (it.message.role === 'assistant' && t && t.output > 0) { used = contextTokens(t); break }
      }
      setContextUsed(used)
      scroll.pinSessionToEnd()
    })
  }, [agentId, scroll.pinSessionToEnd])

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
    setContextUsed(null)
    setSessionCost(0)
    setSessionTokens(null)
    loadContextInfo()
    setTodos([])
    setQueue([])
    queueRef.current = []
    setEditTarget(null)
    setLiveTaskId(null)
    loadTranscript()
    loadTodos()
  }, [loadTranscript, loadTodos, loadContextInfo])

  useEffect(() => {
    reloadSessions()
    loadTranscript()
    loadTodos()
    void window.api.listCommands(cwd).then(setCommands)
    // The agent may already be mid-turn from before a project switch/remount;
    // restore the running state so the Stop button and indicator come back.
    void window.api.isChatRunning(agentId).then(setRunning)
    const off = window.api.onChatEvent(e => applyEvent(e))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cwd])

  const openFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root: cwd })
  }, [cwd])

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
  }, [])

  // Reconcile the feed scroll after committed layout changes: keeps the active
  // anchor pinned while streaming and follows the tail otherwise.
  useLayoutEffect(() => {
    scroll.reconcile()
  }, [items, running, queue, scroll.reconcile])

  // Close the subagent live popup on Escape only (backdrop click no longer closes).
  useEffect(() => {
    if (!liveTaskId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLiveTaskId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [liveTaskId])

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
        if (e.sub === 'delta' && e.reasoning) next.reasoning = (next.reasoning ?? '') + e.reasoning
        if (e.sub === 'tool' && e.tool && !next.tools.includes(e.tool)) next.tools = [...next.tools, e.tool]
        if (e.sub === 'start' && e.subagentType) next.subagentType = e.subagentType
        if (e.sub === 'start' && e.background) next.background = true
        if (e.sub === 'done') {
          next.state = e.state ?? 'completed'
          if (e.result) next.result = e.result
        }
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
    if (e.type === 'queue-updated') {
      const prev = queueRef.current
      queueRef.current = e.queue
      setQueue(e.queue)
      const started = prev.find(p => !e.queue.some(q => q.id === p.id))
      if (started) {
        const optimisticId = 'u-' + started.id
        scroll.startTurnAnchor(optimisticId)
        setItems(prevItems => [...prevItems, {
          kind: 'message', id: optimisticId, role: 'user',
          text: started.displayText ?? started.text, images: started.images
        }])
      }
      return
    }
    if (e.type === 'user-message') {
      scroll.replaceActiveAnchorId(e.message.id)
      setItems(prev => {
        // The desktop UI adds user rows optimistically (local send, 'u-' ids)
        // and via queue-updated. The echo is the truth for that send: replace
        // the pending optimistic row wherever it sits. Text may differ (a
        // slash command's raw text resolves to a different prompt), so don't
        // compare content — an unreplaced 'u-' row is the one to replace.
        // Never drop two identical remote messages (store ids are UUIDs).
        let idx = -1
        for (let i = prev.length - 1; i >= 0; i--) {
          const it = prev[i]
          if (it.kind === 'message' && it.role === 'user' && it.id.startsWith('u-')) {
            idx = i
            break
          }
        }
        const row = { kind: 'message' as const, id: e.message.id, role: 'user' as const, text: e.message.displayText ?? e.message.text, images: e.message.images }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = row
          return next
        }
        return [...prev, row]
      })
      return
    }
if (e.type === 'usage') {
      setContextUsed(contextTokens(e.tokens))
      setSessionCost(e.sessionCost)
      setSessionTokens(e.sessionTokens)
      return
    }
    if (e.type === 'compaction-start') {
      setItems(prev => [...prev, { kind: 'compaction', id: 'c-' + Date.now(), running: true }])
      return
    }
    if (e.type === 'compacted' || e.type === 'compaction-failed') {
      setItems(prev => {
        // Turn the in-progress line into its final state; if none is pending
        // (e.g. older sessions), just append the result line.
        const running = [...prev].reverse().find(
          (i): i is FeedItem & { kind: 'compaction'; running: boolean } => i.kind === 'compaction' && i.running === true
        )
        if (running) {
          return prev.map(i =>
            i === running
              ? { kind: 'compaction', id: running.id, running: false, failed: e.type === 'compaction-failed' }
              : i
          )
        }
        return [...prev, { kind: 'compaction', id: 'c-' + Date.now(), failed: e.type === 'compaction-failed' }]
      })
      return
    }
    if (e.type === 'message-removed') {
      setItems(prev => prev.filter(i =>
        !(i.kind === 'message' && (i.id === e.messageId || i.id === 'u-' + e.messageId))
      ))
      return
    }
    if (e.type === 'done' || e.type === 'error') {
      flushDeltas()
      setRunning(false)
      setPendingPrompt(null)
      if (e.type === 'error') {
        setItems(prev => [...prev, { kind: 'error', id: 'err-' + Date.now(), text: e.message }])
      }
      return
    }
    if (e.type === 'session-created') {
      resetView()
      reloadSessions()
      return
    }
    if (e.type === 'turn-started') {
      setRunning(true)
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
  }, [agentId, flushDeltas, resetView, reloadSessions, scroll.replaceActiveAnchorId, scroll.startTurnAnchor])

  const send = useCallback((text: string, images?: ImageAttachment[]) => {
    const trimmed = text.trim()
    if (!trimmed && (!images || images.length === 0)) return
    // When a turn is already running the message is queued in main; the
    // user message row appears only once the queue drains and the turn starts.
    if (!running) {
      const optimisticId = 'u-' + Date.now()
      scroll.startTurnAnchor(optimisticId)
      setItems(prev => [...prev, {
        kind: 'message', id: optimisticId, role: 'user', text: trimmed, images
      }])
      setRunning(true)
    }
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
    if (m && commands.some(c => c.name === m[1])) {
      void window.api.runCommand(agentId, m[1], m[2] ?? '')
    } else {
      void window.api.sendChat(agentId, trimmed, images)
    }
    reloadSessions()
  }, [agentId, commands, running, reloadSessions, scroll.startTurnAnchor])

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
    const text = buildQuestionAnswer({
      options: pendingPrompt.options,
      customInput,
      questionText,
      selectedOptions
    })
    if (!text.trim()) return
    respond(pendingPrompt.promptId, true, text)
  }, [pendingPrompt, customInput, questionText, selectedOptions, respond])

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
      {lightboxUrl && (
        <div className="chat-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="preview" />
        </div>
      )}
      {liveTaskId && (() => {
        const live = items.find(i => i.kind === 'subagent' && i.taskId === liveTaskId) as FeedItem & { kind: 'subagent' } | undefined
        if (!live) return null
        return (
          <div className="dialog-backdrop">
            <div className="dialog subagent-live">
              <h3>sub-agent{live.subagentType ? ` (${live.subagentType})` : ''}{live.background ? ' · background' : ''}</h3>
              <button className="dialog-close" aria-label="Close" onClick={() => setLiveTaskId(null)}>✕</button>
              <div className="subagent-live-state">
                <span className={`subagent-state state-${live.state}`}>{live.state}</span>
                {live.tools.length > 0 && live.tools.map(t => <code key={t}>{t}</code>)}
              </div>
              {live.reasoning && <details className="chat-reasoning"><summary>Thinking</summary><div className="chat-reasoning-text">{live.reasoning}</div></details>}
              <div className="subagent-live-text">{live.text || (live.state === 'running' ? '…' : '')}</div>
              {live.result && <div className="subagent-live-result">{live.result}</div>}
            </div>
          </div>
        )
      })()}
      <SessionBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={handleCreateSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
      />
      <div className="chat-history-actions">
        <button className="btn small" title="Undo last turn" onClick={handleUndo} disabled={running}>Undo</button>
        <button className="btn small" title="Redo undone turn" onClick={handleRedo} disabled={running}>Redo</button>
      </div>
      {todos.length > 0 && (
        <div className="chat-todos">
          <div className="chat-todos-head">
            <span className="chat-todos-title">TODO LIST</span>
            <span className="chat-todos-count">{doneCount}/{todos.length}</span>
            <button
              className={`chat-todos-toggle ${todosCollapsed ? 'collapsed' : ''}`}
              title={todosCollapsed ? 'Expand' : 'Collapse'}
              aria-label={todosCollapsed ? 'Expand todo list' : 'Collapse todo list'}
              onClick={() => setTodosCollapsed(v => !v)}
            >
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </div>
          {!todosCollapsed && (
          <ul className="chat-todos-list">
            {todos.map((t, i) => (
              <li key={i} className={`chat-todo status-${t.status}`}>
                <span className="chat-todo-mark">{todoMark(t.status)}</span>
                <span className="chat-todo-content">{t.content}</span>
              </li>
            ))}
          </ul>
          )}
        </div>
      )}
      <div className="chat-feed-wrap">
        <div
          className="chat-feed"
          ref={scroll.feedRef}
          tabIndex={0}
          onScroll={scroll.onScroll}
          onWheel={scroll.onWheel}
          onTouchMove={scroll.onTouchMove}
          onPointerDown={scroll.onPointerDown}
          onPointerUp={scroll.onPointerUp}
          onKeyDown={scroll.onKeyDown}
        >
        <div className="chat-feed-content" ref={scroll.contentRef}>
        {items.map(item => {
          if (item.kind === 'compaction') {
            return (
              <div key={item.id} className={`chat-compacted ${item.failed ? 'failed' : ''} ${item.running ? 'running' : ''}`}>
                {item.running ? 'Compacting context…' : (item.failed ? 'Context compaction failed' : 'Context compacted')}
              </div>
            )
          }
          if (item.kind === 'message') {
            if (item.role === 'assistant' && item.text.trim() === '' && !item.reasoning) return null
            return (
              <FeedMessage
                key={item.id}
                messageId={item.id}
                role={item.role}
                text={item.text}
                reasoning={item.reasoning}
                images={item.images}
                commands={commands}
                onOpenImage={setLightboxUrl}
                onOpenFile={openFile}
              />
            )
          }
          if (item.kind === 'tool') {
            return <ToolCallCard key={item.id} call={item.call} />
          }
          if (item.kind === 'subagent') {
            return (
              <div
                key={item.taskId}
                className={`subagent ${item.state === 'running' ? 'running' : ''} ${item.background ? 'background' : ''}`}
                onClick={() => setLiveTaskId(item.taskId)}
                title="Open live view"
              >
                <div className="subagent-head">
                  <span className="subagent-name">sub-agent{item.subagentType ? ` (${item.subagentType})` : ''}</span>
                  {item.background && <span className="subagent-bg">bg</span>}
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
        {queue.length > 0 && (
          <div className="chat-queue">
            {queue.map(q => (
              <div key={q.id} className="chat-queue-item">
                <span className="chat-queue-badge">queued</span>
                <span className="chat-queue-text" onClick={() => setEditTarget({ ...q, text: q.displayText ?? q.text })} title="Edit">{q.displayText ?? q.text}</span>
                <button
                  className="chat-queue-remove"
                  aria-label={`remove queued ${q.displayText ?? q.text}`}
                  onClick={() => void window.api.removeQueued(agentId, q.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-latest-boundary" ref={scroll.latestRef} aria-hidden="true" />
        <div className="chat-turn-tail" ref={scroll.tailRef} aria-hidden="true" />
        <div ref={scroll.endRef} aria-hidden="true" />
        </div>
      </div>
      {scroll.showJumpToEnd && (
        <button className="chat-jump-to-end" onClick={scroll.jumpToEnd} title="Scroll to end" aria-label="Scroll to end">
          <ChevronDown size={14} aria-hidden="true" />
          <span>Scroll to end</span>
        </button>
      )}
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
            Build
          </button>
          <button
            className={`btn small mode-plan ${currentMode === 'plan' ? 'active' : ''}`}
            onClick={() => switchMode('plan')}
          >
            Plan
          </button>
          {currentMode === 'plan' && <span className="chat-mode-hint">read-only — edits denied</span>}
          <div className="chat-mode-tools">
            <ModelPicker agentId={agentId} />
            {availableVariants.length > 0 && (
              <VariantPicker
                variants={availableVariants}
                value={currentVariant}
                onChange={v => {
                  setCurrentVariant(v)
                  onVariantChange?.(v === '' ? undefined : v)
                }}
              />
            )}
          </div>
        </div>
        <ChatInput
          agentId={agentId}
          running={running}
          mode={currentMode}
          commands={commands}
          editTarget={editTarget}
          onSubmit={send}
          onEditSubmit={(id, text) => {
            void window.api.editQueued(agentId, id, text)
            setEditTarget(null)
          }}
          onEditCancel={() => setEditTarget(null)}
          onStop={handleStop}
        />
        <ContextFooter
          tokens={contextUsed}
          limit={contextLimit}
          compactThreshold={compactThreshold}
          cost={sessionCost}
          sessionTokens={sessionTokens}
        />
      </div>
    </div>
  )
}

export default memo(ChatPanel)
