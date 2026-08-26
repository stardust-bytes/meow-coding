import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createJsonStore } from './json-store'
import { TemplateManager } from './template-manager'
import { DEFAULT_TEMPLATES } from './default-templates'
import { WorkspaceStore } from './workspace-store'
import { PtyManager } from './pty-manager'
import { resolveShell } from './terminal-shell'
import { LogManager } from './log-manager'
import { GitStatusService } from './git-status-service'
import { GitService } from './git-service'
import { openGitViewer } from './git-viewer'
import { AlertService } from './alert-service'
import { NotificationService } from './notification-service'
import { Updater } from './updater'
import { SessionStore } from './agent/session'
import type { StoredSession } from './agent/session'
import { SnapshotStore } from './agent/snapshot'
import type { SnapshotTurn } from './agent/snapshot'
import { TruncationStore } from './agent/truncation'
import { TraceStore } from './agent/trace-store'
import { SavedPermissions } from './agent/saved-permissions'
import type { SavedPermission } from './agent/saved-permissions'
import { createDefaultTools } from './agent/tools/registry'
import { isTextPath, openFileViewer, openWithSystemApp, readFileContent } from './file-viewer'
import { MeowAgentManager } from './meow-agent-manager'
import { CommandStore } from './agent/commands'
import { FileWatcher } from './file-watcher'
import { ArtifactStore } from './artifact-store'
import { isPathInside, listDir, shouldIgnore } from './dir-lister'
import type { DirEntry } from '../shared/types'
import { LspManager } from './agent/lsp/manager'
import { ModelsCatalog } from './models-catalog'
import { applyTitleBarTheme, getWindowChromeOptions } from './window-chrome'
import { Vault } from './vault'
import { ConnectionsManager } from './connections/connections-manager'
import { CodexOAuth } from './connections/codex-oauth'
import { CodexProxyManager } from './connections/codex-proxy-manager'
import { ConnectionStore } from './connections/connection-store'
import { E2EConnectionFixtures } from './connections/e2e-fixtures'
import { TrayManager } from './tray-manager'
import { BrowserBridge } from './browser/bridge'
import { createChromeLauncher, ensureExtensionInstalled } from './browser/chrome-launcher'
import { RemoteManager } from './remote/remote-manager'
import { RemoteSettingsStore } from './remote/remote-settings'
import { RemotePairing } from './remote/remote-pairing'
import { Channels } from '../shared/ipc'
import type { AgentState, Command, FileViewerPayload, ImageAttachment, MeowSettings, ModelRef, NewAgentInput, PromptResponse, Template, TerminalInfo, Workspace, WorkspaceRuntime } from '../shared/types'

let win: BrowserWindow | null = null
let isQuitting = false

function binaryName(): string {
  return process.platform === 'win32' ? 'meow-cliproxy.exe' : 'meow-cliproxy'
}
let tray: TrayManager | null = null

if (process.env.MEOW_USER_DATA) app.setPath('userData', process.env.MEOW_USER_DATA)

// Only one instance may run at a time. While the app is hidden to the tray,
// double-clicking the desktop icon would otherwise spawn a second process
// (duplicate browser bridge, duplicated background agents). The second
// instance quits and asks the primary one to show its existing window.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (process.platform === 'darwin') app.show()
    } else {
      createWindow()
    }
  })
}

function openInEditor(projectPath: string): Promise<void> {
  return new Promise(resolve => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `code "${projectPath.replace(/"/g, '""')}"`], {
          windowsHide: true, windowsVerbatimArguments: true
        })
      : spawn('code', [projectPath], { stdio: 'ignore' })
    child.on('error', () => resolve())
    child.on('close', () => resolve())
  })
}

export class MainApp {
  templates = new TemplateManager(
    createJsonStore<Template>(path.join(app.getPath('userData'), 'templates.json')),
    DEFAULT_TEMPLATES
  )
  workspaces = new WorkspaceStore(
    createJsonStore<Workspace>(path.join(app.getPath('userData'), 'workspaces.json'))
  )
  pty = new PtyManager()
  logs = new LogManager(path.join(app.getPath('userData'), 'logs'))
  git = new GitStatusService()
  gitSvc = new GitService()
  alerts = new AlertService()
  builtinSkillsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(app.getAppPath(), 'resources', 'skills')
  browserBridge = new BrowserBridge({
    screenshotDir: path.join(app.getPath('userData'), 'browser-screenshots'),
    snapshotDir: path.join(app.getPath('userData'), 'browser-snapshots')
  })
  browserLauncher = createChromeLauncher({
    getWindow: () => win,
    extensionDir: path.join(app.getPath('userData'), 'browser-extension')
  })
  traces = new TraceStore(path.join(app.getPath('userData'), 'traces'))
  vault = new Vault(path.join(app.getPath('userData'), 'connections', 'vault.json'))
  connections = new ConnectionsManager({
    store: new ConnectionStore(path.join(app.getPath('userData'), 'connections', 'index.json')),
    vault: this.vault,
    oauth: new CodexOAuth({ openExternal: (url) => shell.openExternal(url) }),
    proxy: new CodexProxyManager({
      runtimeDir: path.join(app.getPath('userData'), 'connections', 'runtime'),
      binaryPath: app.isPackaged
        ? path.join(process.resourcesPath, 'cliproxy', binaryName())
        : path.join(app.getAppPath(), 'out', 'cliproxy', `${process.platform}-${process.arch}`, binaryName())
    })
  })
  meowAgent = new MeowAgentManager({
    configPath: path.join(app.getPath('userData'), 'meow.json'),
    vault: this.vault,
    store: new SessionStore(createJsonStore<StoredSession>(path.join(app.getPath('userData'), 'sessions.json'), { debounceMs: 250 })),
    trace: this.traces,
    tools: createDefaultTools({
      getUserSkillsDir: () => path.join(app.getPath('userData'), 'skills'),
      getBuiltinSkillsDir: () => this.builtinSkillsDir,
      getUserDataDir: () => app.getPath('userData'),
      browser: { bridge: this.browserBridge, launcher: this.browserLauncher }
    }),
    userSkillsDir: path.join(app.getPath('userData'), 'skills'),
    userAgentsDir: path.join(app.getPath('userData'), 'agents'),
    userToolsDir: path.join(app.getPath('userData'), 'tools'),
    builtinSkillsDir: this.builtinSkillsDir,
    snapshots: new SnapshotStore(createJsonStore<SnapshotTurn>(path.join(app.getPath('userData'), 'snapshots.json'))),
    savedPermissions: new SavedPermissions(createJsonStore<SavedPermission>(path.join(app.getPath('userData'), 'permissions.json'))),
    truncation: new TruncationStore(path.join(app.getPath('userData'), 'truncation')),
    catalog: new ModelsCatalog(path.join(app.getPath('userData'), 'models.json')),
    commands: new CommandStore(path.join(app.getPath('userData'), 'commands.json')),
    connections: this.connections,
    lsp: new LspManager(),
    notify: new NotificationService(() => !win || !win.isFocused()),
    onActivateAgent: () => {
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    },
    onBackgroundChange: (agentId, background) => {
      win?.webContents.send(Channels.EventAgentBackground, { agentId, background })
    },
    onVariantInvalidated: (agentId) => {
      const ws = this.findWorkspaceByAgent(agentId)
      if (!ws) return
      const updated = this.workspaces.updateAgent(ws.projectPath, agentId, { variant: undefined })
      this.pushAgentConfig(updated, agentId)
    },
    onArtifact: (entry) => {
      const projectPath = this.activeProject
      if (!projectPath || !isPathInside(projectPath, entry.absPath)) return
      this.artifacts.record(projectPath, {
        ...entry,
        agentName: this.resolveAgentName(entry.agentId)
      })
    }
  })
  remoteStore = new RemoteSettingsStore(
    createJsonStore(path.join(app.getPath('userData'), 'remote.json'))
  )
  remote = new RemoteManager({
    store: this.remoteStore,
    pairing: new RemotePairing(),
    context: {
      meowAgent: this.meowAgent,
      workspaceStore: this.workspaces,
      isEnabled: () => this.remoteStore.load().enabled
    }
  })

  private states = new Map<string, AgentState>()
  private gitTimer: ReturnType<typeof setInterval> | null = null
  private activeProject: string | null = null
  private watcher: FileWatcher | null = null
  artifacts = new ArtifactStore((projectPath, artifacts) => {
    win?.webContents.send(Channels.EventArtifactsChanged, { projectPath, artifacts })
  })
  private prices = new Map<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>()
  private ptyStartTs = new Map<string, number>()
  private updater: Updater

  constructor() {
    this.pty.on('data', ({ agentId, data }) => {
      if (this.pty.isTerminal(agentId)) {
        win?.webContents.send(Channels.EventPtyData, { agentId, data })
        return
      }
      this.logs.append(agentId, data)
      this.alerts.onOutput(agentId)
      this.setState(agentId, { status: 'running', lastOutputAt: Date.now() })
      win?.webContents.send(Channels.EventPtyData, { agentId, data })
    })
    this.pty.on('exit', ({ agentId, exitCode, kind }) => {
      if (kind === 'terminal') {
        win?.webContents.send(Channels.EventTerminalExit, { id: agentId, exitCode })
        return
      }
      const code = exitCode ?? -1
      if (code !== 0 && !this.logs.exists(agentId)) {
        const ws = this.findWorkspaceByAgent(agentId)
        const agent = ws?.agents.find(a => a.id === agentId)
        const tmpl = agent ? this.templates.list().find(t => t.id === agent.templateId) : undefined
        const label = tmpl ? `${tmpl.command} ${tmpl.args.join(' ')}`.trim() : (agent?.name ?? agentId)
        const hint = `[meow] Agent thoát với exit code ${code} và không có output. Kiểm tra lệnh "${label}" có trong PATH không, rồi dùng restart.\n`
        this.logs.append(agentId, hint)
        win?.webContents.send(Channels.EventPtyData, { agentId, data: hint })
      }
      this.alerts.onExit(agentId, code)
      const startTs = this.ptyStartTs.get(agentId)
      if (startTs !== undefined && mainApp.meowAgent.isTraceEnabled()) {
        this.ptyStartTs.delete(agentId)
        this.traces.append(agentId, {
          type: 'pty-run', agentId, sessionId: agentId, startTs,
          endTs: Date.now(), exitCode: code, durationMs: Date.now() - startTs,
          logPath: this.logs.pathFor(agentId)
        })
      }
    })
    this.alerts.on('idle', ({ agentId }) => {
      this.setState(agentId, { status: 'idle', alert: 'attention' })
    })
    this.alerts.on('exit', ({ agentId, exitCode }) => {
      const patch = exitCode === 0
        ? { status: 'exited' as const, alert: 'normal' as const, exitCode }
        : { status: 'error' as const, alert: 'error' as const, exitCode }
      this.setState(agentId, patch)
    })
    this.meowAgent.setOnEvent(event => {
      // Native agents have no PTY, so their AgentState comes from chat events.
      // Keeps the pane header/badge/background panel status truthful.
      if (event.type === 'turn-started') {
        this.setState(event.agentId, { status: 'running', lastOutputAt: Date.now(), alert: 'normal' })
      } else if (event.type === 'done' || event.type === 'error') {
        this.setState(event.agentId, { status: 'idle', alert: 'normal' })
      }
      mainApp.remote?.handleAgentEvent(event)
      win?.webContents.send(Channels.EventChat, event)
    })
    this.updater = new Updater(
      (e) => {
        win?.webContents.send(Channels.EventUpdaterStatus, e)
        if (e.type === 'downloaded') {
          // Download finished in the background — let the user know even with
          // the dialog closed; clicking installs and restarts.
          const n = new Notification({
            title: 'Meow Coding',
            body: `[meow] v${e.version} đã tải xong. Click để cài đặt và khởi động lại.`
          })
          n.on('click', () => this.updater.install())
          n.show()
        }
      },
      {
        isPackaged: app.isPackaged,
        isPortable: () => !!process.env.PORTABLE_EXECUTABLE_FILE,
        isAppImage: () => process.platform === 'linux' && !!process.env.APPIMAGE,
        getCurrentVersion: () => app.getVersion()
      }
    )
  }

  checkForUpdates(): void {
    void this.updater.check(true)
  }

  installUpdate(): void {
    this.updater.install()
  }

  checkForUpdatesAuto(): void {
    if (app.isPackaged) void this.updater.check(false)
  }

  private setState(agentId: string, patch: Partial<AgentState>): void {
    const prev = this.states.get(agentId) ?? {
      agentId, status: 'spawning' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const
    }
    const next = { ...prev, ...patch, agentId }
    this.states.set(agentId, next)
    const visibleChanged =
      next.status !== prev.status ||
      next.exitCode !== prev.exitCode ||
      next.alert !== prev.alert
    if (visibleChanged) {
      win?.webContents.send(Channels.EventAgentState, { agentId, state: next })
    }
  }

  clearState(agentId: string): void {
    this.states.delete(agentId)
  }

  private findWorkspaceByAgent(agentId: string): Workspace | undefined {
    return this.workspaces.list().map(s => this.workspaces.get(s.projectPath))
      .find(w => w && w.agents.some(a => a.id === agentId))
  }

  runtimeFor(workspace: Workspace): WorkspaceRuntime {
    return {
      workspace,
      agents: workspace.agents.map(a => this.states.get(a.id) ?? {
        agentId: a.id,
        status: a.kind === 'native' ? 'idle' : 'spawning',
        exitCode: null,
        lastOutputAt: null,
        alert: 'normal'
      }),
      git: null
    }
  }

  async startAgent(agentId: string): Promise<void> {
    if (this.pty.isRunning(agentId)) return
    const ws = this.findWorkspaceByAgent(agentId)
    const agent = ws?.agents.find(a => a.id === agentId)
    if (!agent) return
    if (agent.kind === 'native') return
    const tmpl = this.templates.list().find(t => t.id === agent.templateId)
    if (!tmpl) {
      const message = `[meow] Không tìm thấy template "${agent.templateId}" cho agent "${agent.name}". Thêm template đó hoặc xóa agent này.\n`
      this.logs.append(agentId, message)
      win?.webContents.send(Channels.EventPtyData, { agentId, data: message })
      this.setState(agentId, { status: 'error', alert: 'error' })
      return
    }
    this.setState(agentId, { status: 'spawning', exitCode: null, alert: 'normal' })
    try {
      this.pty.start(agentId, agent.name, tmpl.command, tmpl.args, agent.cwd)
      this.ptyStartTs.set(agentId, Date.now())
      if (mainApp.meowAgent.isTraceEnabled()) {
        this.traces.append(agentId, {
          type: 'pty-run', agentId, sessionId: agentId, startTs: this.ptyStartTs.get(agentId) ?? Date.now(),
          logPath: this.logs.pathFor(agentId)
        })
      }
      this.alerts.track(agentId)
    } catch (err) {
      const message = `[meow] Không thể khởi động agent "${agent.name}" (${tmpl.command} ${tmpl.args.join(' ')}): ${String(err)}\n`
      this.logs.append(agentId, message)
      win?.webContents.send(Channels.EventPtyData, { agentId, data: message })
      this.setState(agentId, { status: 'error', alert: 'error' })
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    await this.pty.stop(agentId)
    this.setState(agentId, { status: 'stopped', alert: 'normal' })
  }

  async restartAgent(agentId: string): Promise<void> {
    await this.pty.stop(agentId)
    await this.startAgent(agentId)
  }

  async openTerminal(cwd: string): Promise<TerminalInfo> {
    const id = `term-${randomUUID()}`
    const name = path.basename(cwd) || cwd
    this.pty.startTerminal(id, resolveShell(), cwd)
    return { id, cwd, name, status: 'running' }
  }

  async closeTerminal(id: string): Promise<void> {
    await this.pty.stop(id)
  }

  closeAllTerminals(): void {
    for (const id of this.pty.terminalIds()) void this.pty.stop(id)
  }

  async openWorkspace(projectPath: string): Promise<WorkspaceRuntime> {
    this.closeAllTerminals()
    const ws = this.workspaces.get(projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    this.activeProject = projectPath
    this.meowAgent.setProjectPath(projectPath)
    // Register native agents synchronously (cheap) so the chat panel mounts
    // with its real transcript immediately; full tools/MCP come from init below.
    for (const agent of ws.agents) {
      if (agent.kind === 'native') this.meowAgent.addAgent(agent)
    }
    const rt = this.runtimeFor(ws)
    this.startGitPoll(projectPath)
    this.startFileWatcher(projectPath)
    // Tools/MCP sync, model catalog refresh and PTY startup run off the
    // critical path so the pane shell paints instantly instead of waiting for
    // all of them (measured ~0.5s+ on first open).
    void this.prepareWorkspace(ws).catch(err => console.error('[meow] prepareWorkspace:', err))
    return rt
  }

  private async prepareWorkspace(ws: Workspace): Promise<void> {
    await this.meowAgent.init(ws.agents)
    await Promise.all(ws.agents.map(a => this.startAgent(a.id)))
  }

  private startFileWatcher(projectPath: string): void {
    this.watcher?.stop()
    this.watcher = new FileWatcher(projectPath, (files) => {
      win?.webContents.send(Channels.EventContextChanged, { projectPath, files })
      this.recordWatcherChanges(projectPath, files)
    })
    this.watcher.start()
  }

  // PTY agents (opencode, Claude Code CLI, ...) are external processes we
  // cannot instrument, so file changes observed while one is running become
  // artifacts attributed to the most recently active running agent. Only
  // files whose (mtime, size) actually moved count: fs.watch fires for
  // atime/attribute touches that leave content unchanged, and those are not
  // agent edits.
  private recordWatcherChanges(projectPath: string, files: string[]): void {
    const running = [...this.states.entries()]
      .filter(([, s]) => s.status === 'running')
      .sort((a, b) => (b[1].lastOutputAt ?? 0) - (a[1].lastOutputAt ?? 0))
    const agentId = running[0]?.[0]
    if (!agentId) return
    for (const rel of files) {
      if (rel.split('/').some(seg => shouldIgnore(seg))) continue
      if (this.watcher && !this.watcher.hasContentChanged(rel)) continue
      const absPath = path.join(projectPath, rel)
      this.artifacts.record(projectPath, {
        path: rel,
        absPath,
        kind: existsSync(absPath) ? 'edit' : 'create',
        agentId,
        agentName: this.resolveAgentName(agentId)
      })
    }
  }

  private resolveAgentName(agentId: string): string {
    const ws = this.activeProject ? this.workspaces.get(this.activeProject) : undefined
    return ws?.agents.find(a => a.id === agentId)?.name ?? agentId
  }

  dirList(absPath: string): Promise<DirEntry[]> {
    const root = this.activeProject
    if (!root || !isPathInside(root, absPath)) throw new Error('Not a project path')
    return listDir(absPath)
  }

  private startGitPoll(projectPath: string): void {
    if (this.gitTimer) clearInterval(this.gitTimer)
    const poll = async () => {
      const git = await this.git.get(projectPath)
      win?.webContents.send(Channels.EventGitStatus, { projectPath, git })
    }
    void poll()
    this.gitTimer = setInterval(() => void poll(), 5000)
  }

  stopGitPoll(): void {
    if (this.gitTimer) {
      clearInterval(this.gitTimer)
      this.gitTimer = null
    }
  }

  isActiveProject(projectPath: string): boolean {
    return this.activeProject === projectPath
  }

  setAgentMode(agentId: string, mode: 'build' | 'plan'): void {
    this.meowAgent.setMode(agentId, mode)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      const updated = this.workspaces.updateAgent(ws.projectPath, agentId, { mode })
      this.pushAgentConfig(updated, agentId)
    }
  }

  setAgentBackground(agentId: string, background: boolean): void {
    this.meowAgent.setBackground(agentId, background)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      this.workspaces.updateAgent(ws.projectPath, agentId, { background })
    }
  }

  setAgentVariant(agentId: string, variant: string | null): void {
    this.meowAgent.setVariant(agentId, variant ?? undefined)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      const stored = this.meowAgent.getVariant(agentId)
      const updated = this.workspaces.updateAgent(ws.projectPath, agentId, { variant: stored })
      this.pushAgentConfig(updated, agentId)
    }
  }

  setAgentModel(agentId: string, model: ModelRef): void {
    this.meowAgent.setModel(agentId, model)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      const updated = this.workspaces.updateAgent(ws.projectPath, agentId, {
        model: `${model.provider}/${model.model}`,
        accountId: model.accountId
      })
      this.pushAgentConfig(updated, agentId)
    }
  }

  // Keep the renderer's AgentConfig (mode/variant/model) fresh after a change
  // so remounted chat panels don't revert to the pre-change values.
  private pushAgentConfig(ws: Workspace, agentId: string): void {
    const agent = ws.agents.find(a => a.id === agentId)
    if (agent) win?.webContents.send(Channels.EventAgentConfig, { agentId, config: agent })
  }

  resetActiveProject(): void {
    this.stopGitPoll()
    this.watcher?.stop()
    this.watcher = null
    this.meowAgent.stopAll()
    if (this.activeProject) this.artifacts.clear(this.activeProject)
    this.activeProject = null
    this.closeAllTerminals()
    this.states.clear()
    this.alerts.clearAll()
  }
}

export const mainApp = new MainApp()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Meow Coding',
    backgroundColor: '#1e1e1e',
    ...getWindowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  win.on('closed', () => {
    win = null
  })
  win.on('close', (event) => {
    // Closing the window hides it to the tray so agents keep running; real
    // quit only happens through tray Exit / Cmd+Q (isQuitting set by
    // before-quit). If no tray is available, keep the old close-to-quit.
    if (isQuitting || !tray) return
    event.preventDefault()
    tray.hideWindow()
  })
  win.on('maximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: false }))
}

function isExternalUrl(url: string): boolean {
  return /^(https?|mailto):/i.test(url)
}

export function registerIpcHandlers(): void {
  ipcMain.handle(Channels.WorkspaceList, () => mainApp.workspaces.list())

  ipcMain.handle(Channels.WorkspaceAdd, (_e, projectPath: string, name: string) => {
    const ws = mainApp.workspaces.add(projectPath, name)
    if (ws.agents.length === 0) {
      mainApp.workspaces.addAgent(projectPath, {
        name: 'meow',
        templateId: 'meow',
        cwd: projectPath,
        kind: 'native'
      })
    }
    const fresh = mainApp.workspaces.get(projectPath)!
    void mainApp.meowAgent.init(fresh.agents)
    return mainApp.runtimeFor(fresh)
  })

  ipcMain.handle(Channels.WorkspaceRemove, async (_e, projectPath: string) => {
    const ws = mainApp.workspaces.get(projectPath)
    if (ws) {
      for (const agent of ws.agents) {
        mainApp.meowAgent.removeAgent(agent.id)
        await mainApp.pty.stop(agent.id)
        mainApp.clearState(agent.id)
        mainApp.alerts.clear(agent.id)
        mainApp.logs.remove(agent.id)
      }
    }
    if (mainApp.isActiveProject(projectPath)) {
      mainApp.resetActiveProject()
    }
    mainApp.workspaces.remove(projectPath)
  })

  ipcMain.handle(Channels.WorkspaceOpen, (_e, projectPath: string) =>
    mainApp.openWorkspace(projectPath))

  ipcMain.handle(Channels.ProjectOpenInEditor, (_e, projectPath: string) =>
    openInEditor(projectPath))

  ipcMain.handle(Channels.ProjectOpenFolder, async (_e, projectPath: string) => {
    const err = await shell.openPath(projectPath)
    if (err) console.error('[meow] open folder failed:', err)
  })
  ipcMain.handle(Channels.FileOpen, async (_e, payload: FileViewerPayload) => {
    const abs = path.resolve(payload.root, payload.path)
    try {
      const st = await stat(abs)
      if (!st.isFile()) throw new Error('not a file')
    } catch {
      new Notification({ title: 'Meow Coding', body: `[meow] Không tìm thấy file: ${payload.path}` }).show()
      return
    }
    const kind = isTextPath(abs)
    if (kind === false) {
      await openWithSystemApp(abs)
      return
    }
    if (kind === true) {
      openFileViewer(payload, () => win)
      return
    }
    // Unknown extension: probe content to decide text vs binary.
    try {
      await readFileContent(abs)
      openFileViewer(payload, () => win)
    } catch {
      await openWithSystemApp(abs)
    }
  })
  ipcMain.handle(Channels.FileViewerGetContent, (_e, absPath: string) => readFileContent(absPath))
  ipcMain.handle(Channels.FileViewerOpenInEditor, (_e, absPath: string) => openInEditor(absPath))
  ipcMain.handle(Channels.FileViewerShowInFolder, (_e, absPath: string) => {
    shell.showItemInFolder(absPath)
  })
  ipcMain.handle(Channels.GitOpenViewer, (_e, projectPath: string) => openGitViewer(projectPath, () => win))
  ipcMain.handle(Channels.GitGetBranches, (_e, projectPath: string) => mainApp.gitSvc.getBranches(projectPath))
  ipcMain.handle(Channels.GitCreateBranch, (_e, projectPath: string, name: string, base: string) =>
    mainApp.gitSvc.createBranch(projectPath, name, base))
  ipcMain.handle(Channels.GitCheckout, (_e, projectPath: string, branch: string) =>
    mainApp.gitSvc.checkout(projectPath, branch))
  ipcMain.handle(Channels.GitStash, (_e, projectPath: string) => mainApp.gitSvc.stashPush(projectPath))
  ipcMain.handle(Channels.GitStashPop, (_e, projectPath: string) => mainApp.gitSvc.stashPop(projectPath))
  ipcMain.handle(Channels.GitDiscard, (_e, projectPath: string) => mainApp.gitSvc.discard(projectPath))
  ipcMain.handle(Channels.GitStatusDetail, (_e, projectPath: string) => mainApp.gitSvc.getStatusDetail(projectPath))
  ipcMain.handle(Channels.GitGetDiff, (_e, projectPath: string, file?: string, staged?: boolean) =>
    mainApp.gitSvc.getDiff(projectPath, file, staged))
  ipcMain.handle(Channels.GitGetCommits, (_e, projectPath: string, file?: string, count?: number) =>
    mainApp.gitSvc.getCommits(projectPath, file, count))
  ipcMain.handle(Channels.GitGetCommitDiff, (_e, projectPath: string, sha: string) =>
    mainApp.gitSvc.getCommitDiff(projectPath, sha))
  ipcMain.handle(Channels.GitCompareCommits, (_e, projectPath: string, a: string, b: string) =>
    mainApp.gitSvc.compareCommits(projectPath, a, b))
  ipcMain.handle(Channels.GitGetBlame, (_e, projectPath: string, file: string) =>
    mainApp.gitSvc.getBlame(projectPath, file))
  ipcMain.handle(Channels.GitGetFileHistory, (_e, projectPath: string, file: string) =>
    mainApp.gitSvc.getFileHistory(projectPath, file))
  ipcMain.handle(Channels.DirList, (_e, absPath: string) => mainApp.dirList(absPath))
  ipcMain.handle(Channels.ArtifactsList, (_e, projectPath: string) =>
    mainApp.artifacts.list(projectPath))
  ipcMain.handle(Channels.ArtifactsClear, (_e, projectPath: string) => {
    mainApp.artifacts.clear(projectPath)
  })
  ipcMain.handle(Channels.TerminalOpen, (_e, cwd: string) => mainApp.openTerminal(cwd))
  ipcMain.handle(Channels.TerminalClose, (_e, id: string) => mainApp.closeTerminal(id))

  ipcMain.handle(Channels.AgentAdd, async (_e, projectPath: string, input: NewAgentInput) => {
    const tmpl = mainApp.templates.list().find(t => t.id === input.templateId)
    const agentInput = tmpl?.kind ? { ...input, kind: tmpl.kind } : input
    const ws = mainApp.workspaces.addAgent(projectPath, agentInput)
    const added = ws.agents[ws.agents.length - 1]
    mainApp.meowAgent.addAgent(added)
    await mainApp.startAgent(added.id)
    return mainApp.runtimeFor(ws)
  })

  ipcMain.handle(Channels.AgentRemove, async (_e, projectPath: string, agentId: string) => {
    mainApp.meowAgent.removeAgent(agentId)
    await mainApp.pty.stop(agentId)
    mainApp.workspaces.removeAgent(projectPath, agentId)
    mainApp.clearState(agentId)
    mainApp.alerts.clear(agentId)
    mainApp.logs.remove(agentId)
  })

  ipcMain.handle(Channels.AgentSetMode, (_e, agentId: string, mode: 'build' | 'plan') =>
    mainApp.setAgentMode(agentId, mode))
  ipcMain.handle(Channels.AgentSetVariant, (_e, agentId: string, variant: string | null) =>
    mainApp.setAgentVariant(agentId, variant))
  ipcMain.handle(Channels.AgentGetVariants, (_e, agentId: string) =>
    mainApp.meowAgent.getAvailableVariants(agentId))
  ipcMain.handle(Channels.AgentSetModel, (_e, agentId: string, model: ModelRef) =>
    mainApp.setAgentModel(agentId, model))
  ipcMain.handle(Channels.AgentGetModel, (_e, agentId: string) => mainApp.meowAgent.getAgentModel(agentId))
  ipcMain.handle(Channels.AgentGetContext, (_e, agentId: string) => mainApp.meowAgent.getContextInfo(agentId))
  ipcMain.handle(Channels.AgentSetBackground, (_e, agentId: string, background: boolean) =>
    mainApp.setAgentBackground(agentId, background))
  ipcMain.handle(Channels.FilesSuggest, (_e, agentId: string, prefix: string) =>
    mainApp.meowAgent.suggestFiles(agentId, prefix))
  ipcMain.handle(Channels.ProviderModels, () => mainApp.meowAgent.getProviderModels())
  ipcMain.handle(Channels.ProviderFetchModels, (_e, providerId: string) =>
    mainApp.meowAgent.fetchProviderModels(providerId))
  ipcMain.handle(Channels.ProviderCatalog, () => mainApp.meowAgent.listProviderCatalog())
  ipcMain.handle(Channels.ProviderConnect, (_e, providerId: string, apiKey: string, baseUrl?: string) =>
    mainApp.meowAgent.connectProvider(providerId, apiKey, baseUrl))
  ipcMain.handle(Channels.ProviderDisconnect, (_e, providerId: string) =>
    mainApp.meowAgent.disconnectProvider(providerId))

  const connectionBackend = process.env.MEOW_E2E_MOCK_CONNECTIONS === '1'
    ? new E2EConnectionFixtures()
    : mainApp.connections

  ipcMain.handle(Channels.ConnectionList, () => connectionBackend.listAccounts())
  ipcMain.handle(Channels.ConnectionConnectCodex, () => connectionBackend.connectCodex())
  ipcMain.handle(Channels.ConnectionDisconnect, (_e, accountId: string) => {
    if (typeof accountId !== 'string' || accountId === '') throw new Error('invalid account id')
    return connectionBackend.disconnect(accountId)
  })
  ipcMain.handle(Channels.ConnectionSetActive, (_e, accountId: string) => {
    if (typeof accountId !== 'string' || accountId === '') throw new Error('invalid account id')
    return connectionBackend.setActive(accountId)
  })
  ipcMain.handle(Channels.ConnectionGetModels, () => connectionBackend.getActiveCodexModels())

  ipcMain.handle(Channels.TemplateList, () => mainApp.templates.list())
  ipcMain.handle(Channels.TemplateSave, (_e, t: Template) => mainApp.templates.save(t))
  ipcMain.handle(Channels.TemplateRemove, (_e, id: string) => mainApp.templates.remove(id))

  ipcMain.handle(Channels.PickFolder, async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(Channels.PtyStart, (_e, agentId: string) => mainApp.startAgent(agentId))
  ipcMain.handle(Channels.PtyStop, (_e, agentId: string) => mainApp.stopAgent(agentId))
  ipcMain.handle(Channels.PtyRestart, (_e, agentId: string) => mainApp.restartAgent(agentId))
  ipcMain.handle(Channels.PtyInput, (_e, agentId: string, data: string) => {
    mainApp.pty.write(agentId, data)
  })
  ipcMain.handle(Channels.PtyInject, (_e, agentId: string, text: string) => {
    mainApp.pty.write(agentId, text + '\n')
  })
  ipcMain.handle(Channels.PtyResize, (_e, agentId: string, cols: number, rows: number) => {
    mainApp.pty.resize(agentId, cols, rows)
  })
  ipcMain.handle(Channels.LogPath, (_e, agentId: string) => mainApp.logs.pathFor(agentId))
  ipcMain.handle(Channels.LogOpen, (_e, agentId: string) => {
    void shell.openPath(mainApp.logs.pathFor(agentId))
  })
  ipcMain.handle(Channels.ChatSend, (_e, agentId: string, text: string, images?: ImageAttachment[]) =>
    mainApp.meowAgent.send(agentId, text, images))
  ipcMain.handle(Channels.ChatStop, (_e, agentId: string) => mainApp.meowAgent.stopAndDrain(agentId))
  ipcMain.handle(Channels.ChatRunCommand, (_e, agentId: string, name: string, args: string) =>
    mainApp.meowAgent.runCommand(agentId, name, args))
  ipcMain.handle(Channels.ChatUndo, (_e, agentId: string) => mainApp.meowAgent.undo(agentId))
  ipcMain.handle(Channels.ChatRedo, (_e, agentId: string) => mainApp.meowAgent.redo(agentId))
  ipcMain.handle(Channels.ChatNewSession, (_e, agentId: string) => mainApp.meowAgent.newSession(agentId))
  ipcMain.handle(Channels.ChatListMessages, (_e, agentId: string) => mainApp.meowAgent.listMessages(agentId))
  ipcMain.handle(Channels.ChatListTranscript, (_e, agentId: string) => mainApp.meowAgent.listTranscript(agentId))
  ipcMain.handle(Channels.ChatGetTodos, (_e, agentId: string) => mainApp.meowAgent.getTodos(agentId))
  ipcMain.handle(Channels.ChatIsRunning, (_e, agentId: string) => mainApp.meowAgent.isRunning(agentId))
  ipcMain.handle(Channels.ChatRespondPrompt, (_e, agentId: string, promptId: string, resp: PromptResponse) =>
    mainApp.meowAgent.respondPrompt(agentId, promptId, resp))
  ipcMain.handle(Channels.ChatQueueRemove, (_e, agentId: string, id: string) =>
    mainApp.meowAgent.removeQueued(agentId, id))
  ipcMain.handle(Channels.ChatQueueEdit, (_e, agentId: string, id: string, text: string) =>
    mainApp.meowAgent.editQueued(agentId, id, text))
  ipcMain.handle(Channels.SessionList, (_e, agentId: string) => mainApp.meowAgent.listSessions(agentId))
  ipcMain.handle(Channels.SessionCreate, (_e, agentId: string) => mainApp.meowAgent.createSession(agentId))
  ipcMain.handle(Channels.SessionSwitch, (_e, agentId: string, sessionId: string) =>
    mainApp.meowAgent.switchSession(agentId, sessionId))
  ipcMain.handle(Channels.SessionDelete, (_e, agentId: string, sessionId: string) =>
    mainApp.meowAgent.deleteSession(agentId, sessionId))
  ipcMain.handle(Channels.SessionRename, (_e, agentId: string, sessionId: string, title: string) =>
    mainApp.meowAgent.renameSession(agentId, sessionId, title))
  ipcMain.handle(Channels.TraceList, (_e, agentId: string) => mainApp.traces.listForAgent(agentId))
  ipcMain.handle(Channels.TraceRead, (_e, sessionId: string) => mainApp.traces.read(sessionId))
  ipcMain.handle(Channels.TraceDelete, (_e, sessionId: string) => mainApp.traces.delete(sessionId))
  ipcMain.handle(Channels.SettingsGet, () => mainApp.meowAgent.getSettings())
  ipcMain.handle(Channels.SettingsSave, (_e, settings: MeowSettings) =>
    mainApp.meowAgent.saveSettings(settings))
  ipcMain.handle(Channels.McpStatus, () => mainApp.meowAgent.getMcpStatus())
  ipcMain.handle(Channels.McpReconnect, async () => mainApp.meowAgent.reconnectMcp())
  ipcMain.handle(Channels.CommandList, (_e, projectPath: string) => mainApp.meowAgent.listCommands(projectPath))
  ipcMain.handle(Channels.CommandSave, (_e, command: Command) => mainApp.meowAgent.saveCommand(command))
  ipcMain.handle(Channels.CommandRemove, (_e, name: string) => mainApp.meowAgent.removeCommand(name))
  ipcMain.handle(Channels.StatsGet, () => mainApp.meowAgent.getStats())
  ipcMain.handle(Channels.AppQuit, () => app.quit())
  ipcMain.handle(Channels.AppVersion, () => app.getVersion())
  ipcMain.handle(Channels.UpdaterCheck, () => mainApp.checkForUpdates())
  ipcMain.handle(Channels.UpdaterInstall, () => mainApp.installUpdate())
  ipcMain.handle(Channels.WindowMinimize, () => win?.minimize())
  ipcMain.handle(Channels.WindowToggleMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(Channels.WindowClose, () => win?.close())
  ipcMain.handle(Channels.WindowIsMaximized, () => win?.isMaximized() ?? false)
  ipcMain.handle(Channels.WindowSetTheme, (_e, theme: 'dark' | 'light') => applyTitleBarTheme(win, theme))
  ipcMain.handle(Channels.BrowserGetStatus, () => mainApp.browserBridge.getStatus())
  ipcMain.handle(Channels.BrowserPair, () => mainApp.browserBridge.pair())
  ipcMain.handle(Channels.BrowserOpenInstallGuide, () => mainApp.browserLauncher.showInstallGuide())
  ipcMain.handle(Channels.BrowserOpenExtensionFolder, () => mainApp.browserLauncher.openExtensionFolder())
  ipcMain.handle(Channels.BrowserOpenChromeExtensions, () => mainApp.browserLauncher.openChrome())
  ipcMain.handle(Channels.BrowserGetConsoleLogs, (_e, limit?: number) => mainApp.browserBridge.getConsoleLogs(limit))
  ipcMain.handle(Channels.BrowserGetNetworkLogs, (_e, limit?: number) => mainApp.browserBridge.getNetworkLogs(limit))
  ipcMain.handle(Channels.RemoteGetStatus, () => mainApp.remote?.getStatus())
  ipcMain.handle(Channels.RemoteSetEnabled, (_e, enabled: boolean) => mainApp.remote?.setEnabled(enabled))
  ipcMain.handle(Channels.RemoteSetRelayUrl, (_e, url: string) => mainApp.remote?.setRelayUrl(url))
  ipcMain.handle(Channels.RemoteStartPairing, () => mainApp.remote?.startPairing() ?? null)
  ipcMain.handle(Channels.RemoteRevokeToken, () => mainApp.remote?.revokeToken())
}

app.whenReady().then(async () => {
  if (!gotTheLock) return // secondary instance — already quitting
  mainApp.meowAgent.truncationCleanup()
  await mainApp.browserBridge.start().catch(err => {
    console.error('[meow] browser bridge start failed:', err)
  })
  mainApp.browserBridge.onStatusChange(info => {
    win?.webContents.send(Channels.EventBrowserStatus, info)
  })
  mainApp.remote?.onStatusChange(info => {
    win?.webContents.send(Channels.EventRemoteStatus, info)
  })
  await mainApp.connections.init().catch(err => {
    console.error('[meow] connections init failed:', err)
  })
  const extSource = app.isPackaged
    ? path.join(process.resourcesPath, 'browser-extension')
    : path.join(app.getAppPath(), 'out', 'browser-extension')
  ensureExtensionInstalled(extSource, path.join(app.getPath('userData'), 'browser-extension'))
  if (!mainApp.meowAgent.isTraceEnabled()) {
    // Trace temporarily disabled: drop old trace data so nothing lingers.
    rmSync(path.join(app.getPath('userData'), 'traces'), { recursive: true, force: true })
  }
  registerIpcHandlers()
  createWindow()
  tray = TrayManager.create({
    userDataDir: app.getPath('userData'),
    getWindow: () => win,
    onQuit: () => app.quit()
  })
  setTimeout(() => {
    try {
      mainApp.checkForUpdatesAuto()
    } catch (err) {
      console.error('[meow] auto update check failed:', err)
    }
  }, 1500)
  app.on('activate', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) {
      createWindow()
      return
    }
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })
})

let cleaningUp = false
app.on('before-quit', (event) => {
  if (cleaningUp) return
  event.preventDefault()
  cleaningUp = true
  isQuitting = true
  mainApp.stopGitPoll()
  void mainApp.meowAgent.dispose().then(() => {
    return mainApp.traces.flushAll()
  }).then(() => {
    return mainApp.connections.dispose()
  }).then(() => {
    return mainApp.browserBridge.close()
  }).then(() => {
    mainApp.remote?.dispose()
  }).then(() => {
    tray?.dispose()
    tray = null
    mainApp.pty
      .stopAll()
      .finally(() => app.exit(0))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
