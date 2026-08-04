import type { AgentState, GitStatus } from '@shared/types'

interface Props {
  workspaceName: string | null
  git: GitStatus | null
  agents: AgentState[]
}

export default function StatusBar({ workspaceName, git, agents }: Props) {
  const running = agents.filter(a => a.status === 'running' || a.status === 'spawning').length

  return (
    <footer className="status-bar">
      {workspaceName && (
        <span className="sb-item sb-mono">{workspaceName}</span>
      )}
      {git && (
        <span className="sb-item sb-mono sb-dim">
          {git.branch ? `${git.branch} ` : ''}
          {git.dirtyCount > 0 ? `\u25cf ${git.dirtyCount}` : ''}
        </span>
      )}
      <span className="sb-item sb-right sb-mono">
        {running} agent(s) running
      </span>
      <span className="sb-item sb-mono sb-dim">v0.1.0</span>
    </footer>
  )
}
