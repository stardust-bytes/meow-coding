import { useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '@shared/types'

interface Props {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onCreate: () => void
  onDelete: (sessionId: string) => void
}

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(ts).toLocaleDateString()
}

export default function SessionBar({ sessions, activeSessionId, onSelect, onCreate, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const active = sessions.find(s => s.id === activeSessionId) ?? sessions[0]

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="chat-sessions" ref={rootRef}>
      <div className="session-dropdown">
        <button className="session-trigger" title="sessions" onClick={() => setOpen(v => !v)}>
          <span className="session-title">{active?.title ?? 'New session'}</span>
          <span className="session-caret">▾</span>
        </button>
        {open && (
          <div className="session-menu">
            <button
              className="session-new"
              onClick={() => { setOpen(false); onCreate() }}
            >
              + New session
            </button>
            <div className="session-list">
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`session-row ${s.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => { setOpen(false); onSelect(s.id) }}
                >
                  <span className="session-row-title">{s.title}</span>
                  <span className="session-row-meta">{relativeTime(s.updatedAt)} · {s.messageCount} msg</span>
                  <button
                    className="session-row-delete"
                    title="delete session"
                    aria-label={`delete session ${s.title}`}
                    onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
