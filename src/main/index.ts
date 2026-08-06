import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createJsonStore } from './json-store'
import { TemplateManager } from './template-manager'
import { DEFAULT_TEMPLATES } from './default-templates'
import { WorkspaceStore } from './workspace-store'
import { PtyManager } from './pty-manager'
import { LogManager } from './log-manager'
import { GitStatusService } from './git-status-service'
import { AlertService } from './alert-service'
import { SessionStore } from './agent/session'
import type { StoredSession } from './agent/session'
import { SnapshotStore } from './agent/snapshot'
import type { SnapshotTurn } from './agent/snapshot'
import { TruncationStore } from './agent/truncation'
import { SavedPermissions } from './agent/saved-permissions'
import type { SavedPermission } from './agent/saved-permissions'
import { createDefaultTools } from './agent/tools/registry'
import { MeowAgentManager } from './meow-agent-manager'
import { CommandStore } from './agent/commands'
import { FileWatcher } from './file-watcher'
import { LspManager } from './agent/lsp/manager'
import { ModelsCatalog } from './models-catalog'
import { getWindowChromeOptions } from './window-chrome'
import { Channels } from '../shared/ipc'
import type { AgentState, Command, MeowSettings, NewAgentInput, PromptResponse, Template, Workspace, WorkspaceRuntime } from '../shared/types'

let win: BrowserWindow | null = null

if (process.env.MEOW_USER_DATA) app.setPath('userData', process.env.MEOW_USER_DATA)

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

class MainApp {
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
  alerts = new AlertService()
  builtinSkillsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(app.getAppPath(), 'resources', 'skills')
  meowAgent = new MeowAgentManager({
    configPath: path.join(app.getPath('userData'), 'meow.json'),
    store: new SessionStore(createJsonStore<StoredSession>(path.join(app.getPath('userData'), 'sessions.json'))),
    tools: createDefaultTools({
      getUserSkillsDir: () => path.join(app.getPath('userData'), 'skills'),
      getBuiltinSkillsDir: () => this.builtinSkillsDir
    }),
    userSkillsDir: path.join(app.getPath('userData'), 'skills'),
    userToolsDir: path.join(app.getPath('userData'), 'tools'),
    userInstructionsDir: app.getPath('userData'),
    builtinSkillsDir: this.builtinSkillsDir,
    snapshots: new SnapshotStore(createJsonStore<SnapshotTurn>(path.join(app.getPath('userData'), 'snapshots.json'))),
    savedPermissions: new SavedPermissions(createJsonStore<SavedPermission>(path.join(app.getPath('userData'), 'permissions.json'))),
    truncation: new TruncationStore(path.join(app.getPath('userData'), 'truncation')),
    catalog: new ModelsCatalog(path.join(app.getPath('userData'), 'models.json')),
    commands: new CommandStore(path.join(app.getPath('userData'), 'commands.json')),
    lsp: new LspManager()
  })

  private states = new Map<string, AgentState>()
  private gitTimer: ReturnType<typeof setInterval> | null = null
  private activeProject: string | null = null
  private watcher: FileWatcher | null = null
  private prices = new Map<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>()

  constructor() {
    this.pty.on('data', ({ agentId, data }) => {
      this.logs.append(agentId, data)
      this.alerts.onOutput(agentId)
      this.setState(agentId, { status: 'running', lastOutputAt: Date.now() })
      win?.webContents.send(Channels.EventPtyData, { agentId, data })
    })
    this.pty.on('exit', ({ agentId, exitCode }) => {
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
      win?.webContents.send(Channels.EventChat, event)
    })
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
        agentId: a.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
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

  async openWorkspace(projectPath: string): Promise<WorkspaceRuntime> {
    const ws = this.workspaces.get(projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    this.activeProject = projectPath
    this.meowAgent.setProjectPath(projectPath)
    await this.meowAgent.init(ws.agents)
    for (const agent of ws.agents) {
      await this.startAgent(agent.id)
    }
    this.startGitPoll(projectPath)
    this.startFileWatcher(projectPath)
    return this.runtimeFor(ws)
  }

  private startFileWatcher(projectPath: string): void {
    this.watcher?.stop()
    this.watcher = new FileWatcher(projectPath, (files) => {
      win?.webContents.send(Channels.EventContextChanged, { projectPath, files })
    })
    this.watcher.start()
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
      this.workspaces.updateAgent(ws.projectPath, agentId, { mode })
    }
  }

  setAgentVariant(agentId: string, variant: string | null): void {
    this.meowAgent.setVariant(agentId, variant ?? undefined)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      const stored = this.meowAgent.getVariant(agentId)
      this.workspaces.updateAgent(ws.projectPath, agentId, { variant: stored })
    }
  }

  setAgentModel(agentId: string, provider: string, model: string): void {
    this.meowAgent.setModel(agentId, provider, model)
    const ws = this.findWorkspaceByAgent(agentId)
    if (ws) {
      this.workspaces.updateAgent(ws.projectPath, agentId, { model: `${provider}/${model}` })
    }
  }

  resetActiveProject(): void {
    this.stopGitPoll()
    this.watcher?.stop()
    this.watcher = null
    this.meowAgent.stopAll()
    this.activeProject = null
    this.states.clear()
    this.alerts.clearAll()
  }
}

const mainApp = new MainApp()

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
  win.on('maximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send(Channels.EventWindowMaximizedChange, { maximized: false }))
}

function isExternalUrl(url: string): boolean {
  return /^(https?|mailto):/i.test(url)
}

function registerIpcHandlers(): void {
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
  ipcMain.handle(Channels.AgentSetModel, (_e, agentId: string, provider: string, model: string) =>
    mainApp.setAgentModel(agentId, provider, model))
  ipcMain.handle(Channels.AgentGetModel, (_e, agentId: string) => mainApp.meowAgent.getAgentModel(agentId))
  ipcMain.handle(Channels.ProviderModels, () => mainApp.meowAgent.getProviderModels())
  ipcMain.handle(Channels.ProviderFetchModels, (_e, providerId: string) =>
    mainApp.meowAgent.fetchProviderModels(providerId))
  ipcMain.handle(Channels.ProviderCatalog, () => mainApp.meowAgent.listProviderCatalog())
  ipcMain.handle(Channels.ProviderConnect, (_e, providerId: string, apiKey: string, baseUrl?: string) =>
    mainApp.meowAgent.connectProvider(providerId, apiKey, baseUrl))
  ipcMain.handle(Channels.ProviderDisconnect, (_e, providerId: string) =>
    mainApp.meowAgent.disconnectProvider(providerId))

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
  ipcMain.handle(Channels.ChatSend, (_e, agentId: string, text: string) =>
    mainApp.meowAgent.send(agentId, text))
  ipcMain.handle(Channels.ChatStop, (_e, agentId: string) => mainApp.meowAgent.stop(agentId))
  ipcMain.handle(Channels.ChatRunCommand, (_e, agentId: string, name: string, args: string[]) =>
    mainApp.meowAgent.runCommand(agentId, name, args))
  ipcMain.handle(Channels.ChatUndo, (_e, agentId: string) => mainApp.meowAgent.undo(agentId))
  ipcMain.handle(Channels.ChatRedo, (_e, agentId: string) => mainApp.meowAgent.redo(agentId))
  ipcMain.handle(Channels.ChatNewSession, (_e, agentId: string) => mainApp.meowAgent.newSession(agentId))
  ipcMain.handle(Channels.ChatListMessages, (_e, agentId: string) => mainApp.meowAgent.listMessages(agentId))
  ipcMain.handle(Channels.ChatListTranscript, (_e, agentId: string) => mainApp.meowAgent.listTranscript(agentId))
  ipcMain.handle(Channels.ChatGetTodos, (_e, agentId: string) => mainApp.meowAgent.getTodos(agentId))
  ipcMain.handle(Channels.ChatRespondPrompt, (_e, agentId: string, promptId: string, resp: PromptResponse) =>
    mainApp.meowAgent.respondPrompt(agentId, promptId, resp))
  ipcMain.handle(Channels.SessionList, (_e, agentId: string) => mainApp.meowAgent.listSessions(agentId))
  ipcMain.handle(Channels.SessionCreate, (_e, agentId: string) => mainApp.meowAgent.createSession(agentId))
  ipcMain.handle(Channels.SessionSwitch, (_e, agentId: string, sessionId: string) =>
    mainApp.meowAgent.switchSession(agentId, sessionId))
  ipcMain.handle(Channels.SessionDelete, (_e, agentId: string, sessionId: string) =>
    mainApp.meowAgent.deleteSession(agentId, sessionId))
  ipcMain.handle(Channels.SessionRename, (_e, agentId: string, sessionId: string, title: string) =>
    mainApp.meowAgent.renameSession(agentId, sessionId, title))
  ipcMain.handle(Channels.SettingsGet, () => mainApp.meowAgent.getSettings())
  ipcMain.handle(Channels.SettingsSave, (_e, settings: MeowSettings) =>
    mainApp.meowAgent.saveSettings(settings))
  ipcMain.handle(Channels.McpStatus, () => mainApp.meowAgent.getMcpStatus())
  ipcMain.handle(Channels.CommandList, (_e, projectPath: string) => mainApp.meowAgent.listCommands(projectPath))
  ipcMain.handle(Channels.CommandSave, (_e, command: Command) => mainApp.meowAgent.saveCommand(command))
  ipcMain.handle(Channels.CommandRemove, (_e, name: string) => mainApp.meowAgent.removeCommand(name))
  ipcMain.handle(Channels.StatsGet, () => mainApp.meowAgent.getStats())
  ipcMain.handle(Channels.AppQuit, () => app.quit())
  ipcMain.handle(Channels.WindowMinimize, () => win?.minimize())
  ipcMain.handle(Channels.WindowToggleMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(Channels.WindowClose, () => win?.close())
  ipcMain.handle(Channels.WindowIsMaximized, () => win?.isMaximized() ?? false)
}

app.whenReady().then(() => {
  mainApp.meowAgent.truncationCleanup()
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cleaningUp = false
app.on('before-quit', (event) => {
  if (cleaningUp) return
  event.preventDefault()
  cleaningUp = true
  mainApp.stopGitPoll()
  void mainApp.meowAgent.dispose().then(() => {
    mainApp.pty
      .stopAll()
      .finally(() => app.exit(0))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
