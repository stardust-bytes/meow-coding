import type { AgentState, GitStatus, NewAgentInput, Template, WorkspaceRuntime, WorkspaceSummary } from './types'

export const Channels = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  WorkspaceOpen: 'workspace:open',
  AgentAdd: 'agent:add',
  AgentRemove: 'agent:remove',
  TemplateList: 'template:list',
  TemplateSave: 'template:save',
  TemplateRemove: 'template:remove',
  PickFolder: 'dialog:pick-folder',
  PtyStart: 'pty:start',
  PtyStop: 'pty:stop',
  PtyRestart: 'pty:restart',
  PtyInput: 'pty:input',
  PtyInject: 'pty:inject',
  PtyResize: 'pty:resize',
  LogOpen: 'log:open',
  LogPath: 'log:path',
  AppQuit: 'app:quit',
  EventPtyData: 'pty:data',
  EventAgentState: 'agent:state',
  EventGitStatus: 'git:status'
} as const

export interface PtyDataEvent { agentId: string; data: string }
export interface AgentStateEvent { agentId: string; state: AgentState }
export interface GitStatusEvent { projectPath: string; git: GitStatus | null }

export interface AgentApi {
  listWorkspaces(): Promise<WorkspaceSummary[]>
  addWorkspace(projectPath: string, name: string): Promise<WorkspaceRuntime | null>
  removeWorkspace(projectPath: string): Promise<void>
  openWorkspace(projectPath: string): Promise<WorkspaceRuntime>
  addAgent(projectPath: string, input: NewAgentInput): Promise<WorkspaceRuntime>
  removeAgent(projectPath: string, agentId: string): Promise<void>
  listTemplates(): Promise<Template[]>
  saveTemplate(template: Template): Promise<Template>
  removeTemplate(id: string): Promise<void>
  pickFolder(): Promise<string | null>
  startAgent(agentId: string): Promise<void>
  stopAgent(agentId: string): Promise<void>
  restartAgent(agentId: string): Promise<void>
  writeInput(agentId: string, data: string): Promise<void>
  injectPrompt(agentId: string, text: string): Promise<void>
  resizePty(agentId: string, cols: number, rows: number): Promise<void>
  openLog(agentId: string): Promise<void>
  getLogPath(agentId: string): Promise<string>
  quit(): Promise<void>
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onAgentState(cb: (e: AgentStateEvent) => void): () => void
  onGitStatus(cb: (e: GitStatusEvent) => void): () => void
}
