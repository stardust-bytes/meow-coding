import { useEffect, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import type { AgentState, GitStatus } from '@shared/types'

interface Props {
  name: string
  state: AgentState
  git: GitStatus | null
  background?: boolean
  native?: boolean
  isTerminal?: boolean
  active?: boolean
  activeTab?: 'chat' | 'trace'
  traceEnabled?: boolean
  onTabChange?: (tab: 'chat' | 'trace') => void
  onStop: () => void
  onRestart: () => void
  onInject: (text: string) => void
  onOpenLog: () => void
  onToggleBackground?: () => void
  onRemove: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

function MoreIcon() {
  return <Ellipsis size={14} aria-hidden="true" />
}

export default function PaneHeader({
  name, state, git, background = false, native = false, isTerminal = false, active = false,
  activeTab = 'chat', traceEnabled = true, onTabChange,
  onStop, onRestart, onInject, onOpenLog, onToggleBackground, onRemove
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [injecting, setInjecting] = useState(false)
  const [prompt, setPrompt] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const close = () => setMenuOpen(false)

  const submitInject = () => {
    const text = prompt.trim()
    if (text) onInject(text)
    setPrompt('')
    setInjecting(false)
  }

  return (
    <div className={`pane-header ${active ? 'active' : ''} alert-${state.alert}`}>
      <span className={`status-dot status-${state.status}`} />
      <span className="pane-title">{name}</span>
      {native && (
        <span className="pane-tabs">
          <button
            className={`pane-tab${activeTab === 'chat' ? ' active' : ''}`}
            onClick={() => onTabChange?.('chat')}
          >
            Chat
          </button>
          {traceEnabled && (
            <button
              className={`pane-tab${activeTab === 'trace' ? ' active' : ''}`}
              onClick={() => onTabChange?.('trace')}
            >
              Trace
            </button>
          )}
        </span>
      )}
      <span className="pane-status">{STATUS_LABEL[state.status]}
        {state.exitCode !== null && ` (${state.exitCode})`}
      </span>
      <span className="pane-git">
        {git ? (git.branch ? `${git.branch} ` : '') + (git.dirtyCount > 0 ? `\u25cf ${git.dirtyCount}` : '') : '--'}
      </span>
      <span className="pane-actions">
        {injecting && (
          <input
            className="input inject-input"
            autoFocus
            placeholder="prompt..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitInject()
              if (e.key === 'Escape') setInjecting(false)
            }}
          />
        )}
        <div className="pane-menu" ref={rootRef}>
          <button
            className="btn ghost small"
            title="Pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="btn-icon"><MoreIcon /></span>
          </button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown pane-menu-dropdown">
              {isTerminal ? (
                <>
                  <button className="menu-item danger" onClick={() => { close(); onRemove() }}>Close terminal</button>
                </>
              ) : (
                <>
                  {!native && (
                    <>
                      <button className="menu-item" onClick={() => { close(); setInjecting(v => !v) }}>Inject</button>
                      <button className="menu-item" onClick={() => { close(); onOpenLog() }}>Log</button>
                      <button className="menu-item" onClick={() => { close(); onStop() }}>Stop</button>
                    </>
                  )}
                  <button className="menu-item" onClick={() => { close(); onRestart() }}>
                    {native ? 'New session' : 'Restart'}
                  </button>
                  {onToggleBackground && (
                    <button className="menu-item" onClick={() => { close(); onToggleBackground() }}>
                      {background ? 'Open pane' : 'Run in background'}
                    </button>
                  )}
                  <button className="menu-item danger" onClick={() => { close(); onRemove() }}>Delete agent</button>
                </>
              )}
            </div>
          )}
        </div>
      </span>
    </div>
  )
}
