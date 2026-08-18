import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserInstallGuideEvent, ChallengeEvent } from '@shared/ipc'
import type { BrowserStatusInfo } from '@shared/browser-types'
import { ChallengeToast } from './components/ChallengeToast'
import { Terminal } from '@xterm/xterm'
import type {
  AgentConfig, AgentState, GitStatus, Template, TerminalInfo, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import PaneGrid from './components/PaneGrid'
import BackgroundPanel from './components/BackgroundPanel'
import EmptyState from './components/EmptyState'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import SettingsDialog from './components/settings/SettingsDialog'
import BrowserDialog from './components/BrowserDialog'
import InstallGuideDialog from './components/InstallGuideDialog'
import UpdateDialog from './components/UpdateDialog'

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
  const [installGuide, setInstallGuide] = useState<BrowserInstallGuideEvent | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdaterStatusEvent | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
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
    const offConfig = window.api.onAgentConfig(({ agentId, config }) => {
      setRuntime(prev => prev && prev.workspace.agents.some(a => a.id === agentId)
        ? {
            ...prev,
            workspace: {
              ...prev.workspace,
              agents: prev.workspace.agents.map(a => a.id === agentId ? config : a)
            }
          }
        : prev)
    })
    const offChallenge = window.api.onChatGptWebChallenge((e) => {
      setChallenge(e)
    })
    const offBrowser = window.api.onBrowserStatus((info) => {
      setBrowser(info)
    })
    const offInstallGuide = window.api.onBrowserOpenInstallGuide((e) => {
      setInstallGuide(e)
    })
    const offTerminalExit = window.api.onTerminalExit(({ id }) => {
      setTerminals(prev => prev.filter(t => t.id !== id))
      termsRef.current.delete(id)
      buffersRef.current.delete(id)
    })
    const offUpdater = window.api.onUpdaterStatus((e) => {
      setUpdateStatus(e)
      if (e.type === 'update-available') setUpdateDialogOpen(true)
      if (e.type === 'error' || e.type === 'not-supported') setUpdateDialogOpen(false)
    })
    void window.api.getBrowserStatus().then(setBrowser)
    return () => {
      offData()
      offState()
      offGit()
      offBg()
      offConfig()
      offChallenge()
      offBrowser()
      offInstallGuide()
      offTerminalExit()
      offUpdater()
    }
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    for (const t of terminals) {
      termsRef.current.delete(t.id)
      buffersRef.current.delete(t.id)
    }
    const rt = await window.api.openWorkspace(path)
    setRuntime(rt)
    setTerminals([])
    setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
    for (const id of buffersRef.current.keys()) {
      if (!rt.workspace.agents.some(a => a.id === id)) buffersRef.current.delete(id)
    }
  }, [terminals])

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

  const addTerminal = useCallback(async (projectPath: string) => {
    if (runtime?.workspace.projectPath !== projectPath) await openWorkspace(projectPath)
    const t = await window.api.openTerminal(projectPath)
    setTerminals(prev => [...prev, t])
  }, [runtime, openWorkspace])

  const removeTerminal = useCallback((id: string) => {
    void window.api.closeTerminal(id)
    setTerminals(prev => prev.filter(t => t.id !== id))
    termsRef.current.delete(id)
    buffersRef.current.delete(id)
  }, [])

  const handleRemovePane = useCallback((id: string) => {
    if (terminals.some(t => t.id === id)) removeTerminal(id)
    else void removeAgent(id)
  }, [terminals, removeTerminal, removeAgent])

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
    const agentPanes = runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    }))
    const terminalPanes: PaneModel[] = terminals.map(term => ({
      agent: { id: term.id, name: term.name, templateId: '__terminal__', cwd: term.cwd, kind: 'pty' as const },
      state: { agentId: term.id, status: 'running' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const },
      git: runtime.git
    }))
    return [...agentPanes, ...terminalPanes]
  }, [runtime, terminals])

  return (
    <div className="app">
      <ChallengeToast challenge={challenge} onDismiss={() => setChallenge(null)} />
      <TitleBar />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          templates={templates}
          activePath={runtime?.workspace.projectPath ?? null}
          onOpen={openWorkspace}
          onRemove={removeWorkspace}
          onRefresh={refreshWorkspaces}
          onOpenTerminal={addTerminal}
          onOpenSettings={() => setShowSettings(true)}
        />
        <main className="main">
          {panes.length > 0 ? (
            <>
              <PaneGrid
                panes={panes}
                backgrounds={backgrounds}
                isTerminal={id => terminals.some(t => t.id === id)}
                onRemove={handleRemovePane}
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
      {installGuide && (
        <InstallGuideDialog guide={installGuide} onClose={() => setInstallGuide(null)} />
      )}
      {updateDialogOpen && (updateStatus?.type === 'update-available' || updateStatus?.type === 'downloaded' || updateStatus?.type === 'download-progress') && (
        <UpdateDialog
          status={updateStatus}
          onClose={() => setUpdateDialogOpen(false)}
          onInstall={() => void window.api.installUpdate()}
        />
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
