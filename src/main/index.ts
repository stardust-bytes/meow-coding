import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { createJsonStore } from './json-store'
import { TemplateManager } from './template-manager'
import { DEFAULT_TEMPLATES } from './default-templates'
import { WorkspaceStore } from './workspace-store'
import { PtyManager } from './pty-manager'
import { LogManager } from './log-manager'
import { GitStatusService } from './git-status-service'
import { AlertService } from './alert-service'
import { Channels } from '../shared/ipc'
import type { AgentState, NewAgentInput, Template, Workspace, WorkspaceRuntime } from '../shared/types'

let win: BrowserWindow | null = null

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

  private states = new Map<string, AgentState>()
  private gitTimer: ReturnType<typeof setInterval> | null = null
  private activeProject: string | null = null

  constructor() {
    this.pty.on('data', ({ agentId, data }) => {
      this.logs.append(agentId, data)
      this.alerts.onOutput(agentId)
      this.setState(agentId, { status: 'running', lastOutputAt: Date.now() })
      win?.webContents.send(Channels.EventPtyData, { agentId, data })
    })
    this.pty.on('exit', ({ agentId, exitCode }) => {
      this.alerts.onExit(agentId, exitCode ?? -1)
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
  }

  private setState(agentId: string, patch: Partial<AgentState>): void {
    const prev = this.states.get(agentId) ?? {
      agentId, status: 'spawning' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const
    }
    const next = { ...prev, ...patch, agentId }
    this.states.set(agentId, next)
    win?.webContents.send(Channels.EventAgentState, { agentId, state: next })
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
    const tmpl = this.templates.list().find(t => t.id === agent.templateId)
    if (!tmpl) {
      this.setState(agentId, { status: 'error', alert: 'error' })
      return
    }
    this.setState(agentId, { status: 'spawning', exitCode: null, alert: 'normal' })
    try {
      this.pty.start(agentId, agent.name, tmpl.command, tmpl.args, agent.cwd)
    } catch {
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
    if (this.activeProject && this.activeProject !== projectPath) {
      await this.pty.stopAll()
      this.states.clear()
      this.alerts.clearAll()
    }
    this.activeProject = projectPath
    for (const agent of ws.agents) {
      await this.startAgent(agent.id)
    }
    this.startGitPoll(projectPath)
    return this.runtimeFor(ws)
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
}

const mainApp = new MainApp()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Meow Coding',
    backgroundColor: '#1e1e1e',
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
  win.on('closed', () => {
    win = null
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle(Channels.WorkspaceList, () => mainApp.workspaces.list())

  ipcMain.handle(Channels.WorkspaceAdd, (_e, projectPath: string, name: string) => {
    const ws = mainApp.workspaces.add(projectPath, name)
    return mainApp.runtimeFor(ws)
  })

  ipcMain.handle(Channels.WorkspaceRemove, async (_e, projectPath: string) => {
    const ws = mainApp.workspaces.get(projectPath)
    if (ws) {
      for (const agent of ws.agents) {
        await mainApp.pty.stop(agent.id)
      }
    }
    mainApp.workspaces.remove(projectPath)
  })

  ipcMain.handle(Channels.WorkspaceOpen, (_e, projectPath: string) =>
    mainApp.openWorkspace(projectPath))

  ipcMain.handle(Channels.AgentAdd, async (_e, projectPath: string, input: NewAgentInput) => {
    const ws = mainApp.workspaces.addAgent(projectPath, input)
    const added = ws.agents[ws.agents.length - 1]
    await mainApp.startAgent(added.id)
    return mainApp.runtimeFor(ws)
  })

  ipcMain.handle(Channels.AgentRemove, async (_e, projectPath: string, agentId: string) => {
    await mainApp.pty.stop(agentId)
    mainApp.workspaces.removeAgent(projectPath, agentId)
  })

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
  ipcMain.handle(Channels.LogPath, (_e, agentId: string) => mainApp.logs.pathFor(agentId))
  ipcMain.handle(Channels.LogOpen, (_e, agentId: string) => {
    void shell.openPath(mainApp.logs.pathFor(agentId))
  })
  ipcMain.handle(Channels.AppQuit, () => app.quit())
}

app.whenReady().then(() => {
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
  mainApp.pty
    .stopAll()
    .finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
