import { useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '@shared/types'

interface Props {
  sessions: SessionSummary[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onCreate: () => void
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => void
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

export default function SessionBar({ sessions, activeSessionId, onSelect, onCreate, onDelete, onRename }: Props) {
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const active = sessions.find(s => s.id === activeSessionId) ?? sessions[0]

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) {
        setOpen(false)
        setRenamingId(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const startRename = (s: SessionSummary) => {
    setRenamingId(s.id)
    setRenameValue(s.title)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

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
                  {renamingId === s.id ? (
                    <input
                      ref={renameRef}
                      className="session-rename-input"
                      value={renameValue}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <>
                      <span className="session-row-title">{s.title}</span>
                      <span className="session-row-meta">{relativeTime(s.updatedAt)} · {s.messageCount} msg</span>
                    </>
                  )}
                  {renamingId !== s.id && (
                    <button
                      className="session-row-rename"
                      title="rename session"
                      aria-label={`rename session ${s.title}`}
                      onClick={e => { e.stopPropagation(); startRename(s) }}
                    >
                      ✎
                    </button>
                  )}
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
