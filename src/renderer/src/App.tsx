import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'
import type { BrowserStatusInfo } from '@shared/browser-types'
import { Terminal } from '@xterm/xterm'
import type {
  AgentConfig, AgentState, ArtifactEntry, GitStatus, Template, TerminalInfo, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import PaneTabs from './components/PaneTabs'
import BackgroundPanel from './components/BackgroundPanel'
import EmptyState from './components/EmptyState'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import RightPanel from './components/RightPanel'
import SettingsDialog, { type TabId } from './components/settings/SettingsDialog'
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
  const [settingsTab, setSettingsTab] = useState<TabId>('agents')
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null)
  const [backgrounds, setBackgrounds] = useState<Record<string, boolean>>({})
  const [browser, setBrowser] = useState<BrowserStatusInfo | null>(null)
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false)
  const [installGuide, setInstallGuide] = useState<BrowserInstallGuideEvent | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdaterStatusEvent | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [upToDateOpen, setUpToDateOpen] = useState(false)
  const manualCheckRef = useRef(false)
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('meow.rightpanel.open') !== '0')
  const [rightTab, setRightTab] = useState<'tree' | 'artifacts'>(() =>
    localStorage.getItem('meow.rightpanel.tab') === 'artifacts' ? 'artifacts' : 'tree')
  const [rightWidth, setRightWidth] = useState(() => {
    const w = Number(localStorage.getItem('meow.rightpanel.width'))
    return Number.isFinite(w) && w >= 240 && w <= 600 ? w : 280
  })
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactEntry[]>>({})
  // Project path -> agent ids currently waiting on a permission/question
  // prompt (needs user reply/approval). Drives the sidebar badges.
  const [needsInput, setNeedsInput] = useState<Record<string, string[]>>({})
  // Active tab per project path so switching workspaces and coming back restores
  // the tab that was showing (persisted across restarts too).
  const [activeTabByPath, setActiveTabByPath] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('meow.activeTabByPath')
      return raw ? JSON.parse(raw) as Record<string, string> : {}
    } catch {
      return {}
    }
  })
  const termsRef = useRef<Map<string, Terminal>>(new Map())
  const buffersRef = useRef<Map<string, string>>(new Map())
  // Latest values for use inside stable effect subscriptions.
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  useEffect(() => {
    localStorage.setItem('meow.rightpanel.open', rightOpen ? '1' : '0')
  }, [rightOpen])
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.tab', rightTab)
  }, [rightTab])
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.width', String(rightWidth))
  }, [rightWidth])
  useEffect(() => {
    localStorage.setItem('meow.activeTabByPath', JSON.stringify(activeTabByPath))
  }, [activeTabByPath])

  useEffect(() => {
    return window.api.onArtifactsChanged(({ projectPath, artifacts: list }) => {
      setArtifacts(prev => ({ ...prev, [projectPath]: list }))
    })
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
      setUpdateChecking(e.type === 'checking')
      // Download runs in the background even when the popup is closed — when
      // it finishes, bring the dialog back so the user can restart now or
      // defer to later.
      if (e.type === 'update-available' || e.type === 'downloaded') setUpdateDialogOpen(true)
      if (e.type === 'error' || e.type === 'not-supported') setUpdateDialogOpen(false)
      // Only surface "up to date" when the user asked for a manual check —
      // the automatic check on startup must not pop a dialog.
      if (e.type === 'up-to-date' && manualCheckRef.current) {
        manualCheckRef.current = false
        setUpToDateOpen(true)
      }
    })
    void window.api.getBrowserStatus().then(setBrowser)
    return () => {
      offData()
      offState()
      offGit()
      offBg()
      offConfig()
      offBrowser()
      offInstallGuide()
      offTerminalExit()
      offUpdater()
    }
  }, [])

  // Sidebar "needs input" badges: seed from main (agents waiting from before
  // this window mounted) then keep in sync via push events.
  useEffect(() => {
    const offPrompt = window.api.onPromptState(({ projectPath, agentId, pending }) => {
      setNeedsInput(prev => {
        const list = prev[projectPath] ?? []
        if (pending) {
          if (list.includes(agentId)) return prev
          return { ...prev, [projectPath]: [...list, agentId] }
        }
        if (!list.includes(agentId)) return prev
        const next = list.filter(a => a !== agentId)
        if (next.length === 0) {
          const copy = { ...prev }
          delete copy[projectPath]
          return copy
        }
        return { ...prev, [projectPath]: next }
      })
    })
    void window.api.listPromptStates().then(states => {
      setNeedsInput(Object.fromEntries(states.map(s => [s.projectPath, s.agentIds])))
    })
    // OS notification click -> jump to the project + tab of the waiting agent.
    const offActivate = window.api.onActivateAgent(({ projectPath, agentId }) => {
      setActiveTabByPath(prev => (prev[projectPath] === agentId ? prev : { ...prev, [projectPath]: agentId }))
      if (runtimeRef.current?.workspace.projectPath !== projectPath) {
        void openWorkspaceRef.current(projectPath)
      }
    })
    return () => {
      offPrompt()
      offActivate()
    }
  }, [])

  const handleCheckUpdate = useCallback(() => {
    manualCheckRef.current = true
    window.api.checkForUpdates()
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    for (const t of terminals) {
      termsRef.current.delete(t.id)
      buffersRef.current.delete(t.id)
    }
    const rt = await window.api.openWorkspace(path)
    const list = await window.api.listArtifacts(path)
    setRuntime(rt)
    setTerminals([])
    setArtifacts(prev => ({ ...prev, [path]: list }))
    setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
    for (const id of buffersRef.current.keys()) {
      if (!rt.workspace.agents.some(a => a.id === id)) buffersRef.current.delete(id)
    }
  }, [terminals])
  const openWorkspaceRef = useRef(openWorkspace)
  openWorkspaceRef.current = openWorkspace

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
    setActiveTabByPath(prev => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
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

  const handleActiveChange = useCallback((id: string) => {
    const path = runtime?.workspace.projectPath
    if (!path) return
    setActiveTabByPath(prev => (prev[path] === id ? prev : { ...prev, [path]: id }))
  }, [runtime?.workspace.projectPath])

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

  // Effective active tab for the current project: the remembered one when it
  // still exists among the panes, otherwise the first pane (PaneTabs syncs the
  // stored value back via onActiveChange).
  const activeId = useMemo(() => {
    if (panes.length === 0) return null
    const path = runtime?.workspace.projectPath
    const remembered = path ? activeTabByPath[path] : undefined
    return remembered && panes.some(p => p.agent.id === remembered) ? remembered : (panes[0]?.agent.id ?? null)
  }, [panes, runtime?.workspace.projectPath, activeTabByPath])

  return (
    <div className="app">
      <TitleBar panelOpen={rightOpen} onTogglePanel={() => setRightOpen(v => !v)} />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          templates={templates}
          needsInput={needsInput}
          activePath={runtime?.workspace.projectPath ?? null}
          onOpen={openWorkspace}
          onRemove={removeWorkspace}
          onRefresh={refreshWorkspaces}
          onOpenSettings={() => { setSettingsTab('agents'); setShowSettings(true) }}
          onOpenProviders={() => { setSettingsTab('providers'); setShowSettings(true) }}
          onOpenGit={path => void window.api.gitOpenViewer(path)}
          onCheckUpdate={handleCheckUpdate}
          updateChecking={updateChecking}
        />
        <main className="main">
          {panes.length > 0 ? (
            <>
              <PaneTabs
                panes={panes}
                activeId={activeId}
                onActiveChange={handleActiveChange}
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
                onRemove={handleRemovePane}
              />
            </>
          ) : (
            <EmptyState hasWorkspace={runtime !== null} />
          )}
        </main>
        {rightOpen && (
          <RightPanel
            root={runtime?.workspace.projectPath ?? null}
            tab={rightTab}
            width={rightWidth}
            artifacts={artifacts[runtime?.workspace.projectPath ?? ''] ?? []}
            onTabChange={setRightTab}
            onWidthChange={setRightWidth}
            onClearArtifacts={() => {
              const p = runtime?.workspace.projectPath
              if (p) void window.api.clearArtifacts(p)
            }}
          />
        )}
      </div>
      <StatusBar
        workspaceName={runtime?.workspace.name ?? null}
        git={runtime?.git ?? null}
        agents={runtime?.agents ?? []}
        browser={browser}
        onBrowserClick={() => setBrowserDialogOpen(true)}
        onGitClick={runtime ? () => void window.api.gitOpenViewer(runtime.workspace.projectPath) : undefined}
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
      {upToDateOpen && (
        <UpToDateDialog version={updateStatus?.type === 'up-to-date' ? updateStatus.currentVersion : undefined} onClose={() => setUpToDateOpen(false)} />
      )}
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          projectPath={runtime?.workspace.projectPath ?? undefined}
          templates={templates}
          onTemplatesChange={setTemplates}
          initialTab={settingsTab}
          agentId={runtime?.workspace.agents[0]?.id}
        />
      )}
    </div>
  )
}

function UpToDateDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Update</h3>
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        <p className="settings-hint">
          This is the latest version{version ? ` (v${version})` : ''}.
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
