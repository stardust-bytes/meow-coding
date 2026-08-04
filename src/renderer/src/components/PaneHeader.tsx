import { useState } from 'react'
import type { AgentState, GitStatus } from '@shared/types'

interface Props {
  name: string
  state: AgentState
  git: GitStatus | null
  zoomed: boolean
  native?: boolean
  onZoom: () => void
  onStop: () => void
  onRestart: () => void
  onInject: (text: string) => void
  onOpenLog: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

export default function PaneHeader({
  name, state, git, zoomed, native = false, onZoom, onStop, onRestart, onInject, onOpenLog
}: Props) {
  const [injecting, setInjecting] = useState(false)
  const [prompt, setPrompt] = useState('')

  const submitInject = () => {
    const text = prompt.trim()
    if (text) onInject(text)
    setPrompt('')
    setInjecting(false)
  }

  return (
    <div className={`pane-header alert-${state.alert}`}>
      <span className={`status-dot status-${state.status}`} />
      <span className="pane-title">{name}</span>
      <span className="pane-status">{STATUS_LABEL[state.status]}
        {state.exitCode !== null && ` (${state.exitCode})`}
      </span>
      <span className="pane-git">
        {git ? (git.branch ? `${git.branch} ` : '') + (git.dirtyCount > 0 ? `\u25cf ${git.dirtyCount}` : '') : '--'}
      </span>
      <span className="pane-actions">
        {!native && (
          <>
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
            <button className="btn small" title="inject prompt" onClick={() => setInjecting(v => !v)}>inject</button>
          </>
        )}
        <button className="btn small" title="stop" onClick={onStop}>stop</button>
        <button className="btn small" title="restart / clear session" onClick={onRestart}>restart</button>
        {!native && (
          <button className="btn small" title="open log" onClick={onOpenLog}>log</button>
        )}
        <button className="btn small" title={zoomed ? 'back to grid' : 'zoom'} onClick={onZoom}>
          {zoomed ? 'exit' : 'zoom'}
        </button>
      </span>
    </div>
  )
}
