import { useEffect, useState } from 'react'
import type { AgentState, GitStatus } from '@shared/types'
import type { BrowserStatusInfo } from '@shared/browser-types'

interface Props {
  workspaceName: string | null
  git: GitStatus | null
  agents: AgentState[]
  browser?: BrowserStatusInfo | null
  onBrowserClick?: () => void
  onGitClick?: () => void
}

export default function StatusBar({ workspaceName, git, agents, browser, onBrowserClick, onGitClick }: Props) {
  const [version, setVersion] = useState('')
  const running = agents.filter(a => a.status === 'running' || a.status === 'spawning').length

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  const waiting = !browser?.paired && (browser?.status === 'listening' || browser?.status === 'idle')
  const browserLabel = browser?.paired
    ? 'browser: paired'
    : waiting
      ? 'browser: waiting'
      : 'browser: off'
  const browserClass = browser?.paired
    ? 'sb-browser-on'
    : waiting
      ? 'sb-browser-waiting'
      : 'sb-browser-off'

  return (
    <footer className="status-bar">
      {workspaceName && (
        <span className="sb-item sb-mono">{workspaceName}</span>
      )}
      {git && (
        <button
          className="sb-item sb-mono sb-dim sb-git"
          onClick={onGitClick}
          title="Open git viewer"
        >
          {git.branch ? `${git.branch} ` : ''}
          {git.dirtyCount > 0 ? `\u25cf ${git.dirtyCount}` : ''}
        </button>
      )}
      <span className="sb-item sb-right sb-mono">
        {running} agent(s) running
      </span>
      <button
        className={`sb-item sb-mono sb-browser ${browserClass}`}
        onClick={onBrowserClick}
        title="Open browser bridge settings"
      >
        {browserLabel}
      </button>
      <span className="sb-item sb-mono sb-dim">{version ? `v${version}` : ''}</span>
    </footer>
  )
}
