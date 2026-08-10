import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChallengeEvent } from '@shared/ipc'
import type { BrowserStatusInfo } from '@shared/browser-types'
import { ChallengeToast } from './components/ChallengeToast'
import { Terminal } from '@xterm/xterm'
import type {
  AgentConfig, AgentState, GitStatus, Template, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import PaneGrid from './components/PaneGrid'
import BackgroundPanel from './components/BackgroundPanel'
import EmptyState from './components/EmptyState'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import SettingsDialog from './components/settings/SettingsDialog'
import BrowserDialog from './components/BrowserDialog'

export interface PaneModel {
  agent: AgentConfig
  state: AgentState
  git: GitStatus | null
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null)
  const [backgrounds, setBackgrounds] = useState<Record<string, boolean>>({})
  const [challenge, setChallenge] = useState<ChallengeEvent | null>(null)
  const [browser, setBrowser] = useState<BrowserStatusInfo | null>(null)
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false)
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
    const offBg = window.api.onAgentBackground(({ agentId, background }) => {
      setBackgrounds(prev => ({ ...prev, [agentId]: background }))
    })
    const offChallenge = window.api.onChatGptWebChallenge((e) => {
      setChallenge(e)
    })
    const offBrowser = window.api.onBrowserStatus((info) => {
      setBrowser(info)
    })
    void window.api.getBrowserStatus().then(setBrowser)
    return () => {
      offData()
      offState()
      offGit()
      offBg()
      offChallenge()
      offBrowser()
    }
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    const rt = await window.api.openWorkspace(path)
    setRuntime(rt)
    setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
    for (const id of buffersRef.current.keys()) {
      if (!rt.workspace.agents.some(a => a.id === id)) buffersRef.current.delete(id)
    }
  }, [])

  const removeWorkspace = useCallback(async (path: string) => {
    if (runtime?.workspace.projectPath === path) {
      for (const agent of runtime.workspace.agents) {
        termsRef.current.delete(agent.id)
        buffersRef.current.delete(agent.id)
      }
    }
    try {
      await window.api.removeWorkspace(path)
    } catch {
      /* surface via sidebar later; still refresh list */
    }
    setRuntime(prev => prev && prev.workspace.projectPath === path ? null : prev)
    void refreshWorkspaces()
  }, [runtime, refreshWorkspaces])

  const removeAgent = useCallback(async (agentId: string) => {
    const path = runtime?.workspace.projectPath
    if (!path) return
    try {
      await window.api.removeAgent(path, agentId)
    } catch {
      /* surface via pane menu later; still refresh */
    }
    termsRef.current.delete(agentId)
    buffersRef.current.delete(agentId)
    const rt = await window.api.openWorkspace(path)
    setRuntime(rt)
    setWorkspaces(await window.api.listWorkspaces())
  }, [runtime])

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
      <ChallengeToast challenge={challenge} onDismiss={() => setChallenge(null)} />
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          templates={templates}
          activePath={runtime?.workspace.projectPath ?? null}
          onOpen={openWorkspace}
          onRemove={removeWorkspace}
          onRefresh={refreshWorkspaces}
        />
        <main className="main">
          {panes.length > 0 ? (
            <>
              <PaneGrid
                panes={panes}
                backgrounds={backgrounds}
                onRemove={removeAgent}
                onRegisterTerminal={registerTerminal}
                onUnregisterTerminal={unregisterTerminal}
              />
              <BackgroundPanel
                panes={panes}
                backgrounds={backgrounds}
                onOpen={agentId => void window.api.setAgentBackground(agentId, false)}
                onStop={agentId => {
                  const pane = panes.find(p => p.agent.id === agentId)
                  if (pane?.agent.kind === 'native') void window.api.stopChat(agentId)
                  else void window.api.stopAgent(agentId)
                }}
              />
            </>
          ) : (
            <EmptyState hasWorkspace={runtime !== null} />
          )}
        </main>
      </div>
      <StatusBar
        workspaceName={runtime?.workspace.name ?? null}
        git={runtime?.git ?? null}
        agents={runtime?.agents ?? []}
        browser={browser}
        onBrowserClick={() => setBrowserDialogOpen(true)}
      />
      {browserDialogOpen && (
        <BrowserDialog status={browser} onClose={() => setBrowserDialogOpen(false)} />
      )}
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          projectPath={runtime?.workspace.projectPath ?? undefined}
          templates={templates}
          onTemplatesChange={setTemplates}
        />
      )}
    </div>
  )
}
