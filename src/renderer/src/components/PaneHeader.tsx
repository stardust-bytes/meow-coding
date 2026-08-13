import { useEffect, useRef, useState } from 'react'
import type { AgentState, GitStatus } from '@shared/types'

interface Props {
  name: string
  state: AgentState
  git: GitStatus | null
  zoomed: boolean
  background?: boolean
  native?: boolean
  isTerminal?: boolean
  active?: boolean
  onZoom: () => void
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
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  )
}

export default function PaneHeader({
  name, state, git, zoomed, background = false, native = false, isTerminal = false, active = false,
  onZoom, onStop, onRestart, onInject, onOpenLog, onToggleBackground, onRemove
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
            title="pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="btn-icon"><MoreIcon /></span>
          </button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown pane-menu-dropdown">
              {isTerminal ? (
                <>
                  <button className="menu-item" onClick={() => { close(); onZoom() }}>
                    {zoomed ? 'Exit zoom' : 'Zoom'}
                  </button>
                  <button className="menu-item danger" onClick={() => { close(); onRemove() }}>Close terminal</button>
                </>
              ) : (
                <>
                  {!native && (
                    <>
                      <button className="menu-item" onClick={() => { close(); setInjecting(v => !v) }}>Inject</button>
                      <button className="menu-item" onClick={() => { close(); onOpenLog() }}>Log</button>
                      <button className="menu-item" onClick={() => { close(); onStop() }}>Stop</button>
                      <button className="menu-item" onClick={() => { close(); onZoom() }}>
                        {zoomed ? 'Exit zoom' : 'Zoom'}
                      </button>
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
