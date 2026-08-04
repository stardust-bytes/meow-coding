import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type {
  AgentConfig, AgentState, GitStatus, Template, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import PaneGrid from './components/PaneGrid'
import EmptyState from './components/EmptyState'

export interface PaneModel {
  agent: AgentConfig
  state: AgentState
  git: GitStatus | null
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null)
  const termsRef = useRef<Map<string, Terminal>>(new Map())
  const buffersRef = useRef<Map<string, string>>(new Map())

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
    void window.api.listTemplates().then(setTemplates)
  }, [refreshWorkspaces])

  useEffect(() => {
    const offData = window.api.onPtyData(({ agentId, data }) => {
      const term = termsRef.current.get(agentId)
      if (term) {
        term.write(data)
      } else {
        buffersRef.current.set(agentId, (buffersRef.current.get(agentId) ?? '') + data)
      }
    })
    const offState = window.api.onAgentState(({ agentId, state }) => {
      setRuntime(prev => prev
        ? { ...prev, agents: prev.agents.map(a => (a.agentId === agentId ? state : a)) }
        : prev)
    })
    const offGit = window.api.onGitStatus(({ projectPath, git }) => {
      setRuntime(prev => prev && prev.workspace.projectPath === projectPath
        ? { ...prev, git }
        : prev)
    })
    return () => {
      offData()
      offState()
      offGit()
    }
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    const rt = await window.api.openWorkspace(path)
    setRuntime(rt)
    for (const id of buffersRef.current.keys()) {
      if (!rt.workspace.agents.some(a => a.id === id)) buffersRef.current.delete(id)
    }
  }, [])

  const registerTerminal = useCallback((agentId: string, term: Terminal) => {
    termsRef.current.set(agentId, term)
    const buf = buffersRef.current.get(agentId)
    if (buf) {
      term.write(buf)
      buffersRef.current.delete(agentId)
    }
  }, [])

  const unregisterTerminal = useCallback((agentId: string) => {
    termsRef.current.delete(agentId)
    buffersRef.current.delete(agentId)
  }, [])

  const panes: PaneModel[] = useMemo(() => {
    if (!runtime) return []
    return runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    }))
  }, [runtime])

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        templates={templates}
        activePath={runtime?.workspace.projectPath ?? null}
        onOpen={openWorkspace}
        onRefresh={refreshWorkspaces}
        onTemplatesChange={setTemplates}
      />
      <main className="main">
        {panes.length > 0 ? (
          <PaneGrid
            panes={panes}
            onRegisterTerminal={registerTerminal}
            onUnregisterTerminal={unregisterTerminal}
          />
        ) : (
          <EmptyState hasWorkspace={runtime !== null} />
        )}
      </main>
    </div>
  )
}
