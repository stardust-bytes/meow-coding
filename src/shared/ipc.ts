import type {
  AgentState, ChatEvent, ChatMessage, GitStatus, McpServerStatus, MeowSettings, NewAgentInput,
  PromptResponse, Template, WorkspaceRuntime, WorkspaceSummary
} from './types'

export const Channels = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  WorkspaceOpen: 'workspace:open',
  AgentAdd: 'agent:add',
  AgentRemove: 'agent:remove',
  AgentSetMode: 'agent:set-mode',
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
  ChatSend: 'chat:send',
  ChatStop: 'chat:stop',
  ChatNewSession: 'chat:new-session',
  ChatListMessages: 'chat:list-messages',
  ChatRespondPrompt: 'chat:respond-prompt',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  McpStatus: 'mcp:status',
  EventPtyData: 'pty:data',
  EventAgentState: 'agent:state',
  EventGitStatus: 'git:status',
  EventChat: 'chat:event'
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
  setAgentMode(agentId: string, mode: 'build' | 'plan'): Promise<void>
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
  sendChat(agentId: string, text: string): Promise<void>
  stopChat(agentId: string): Promise<void>
  newChatSession(agentId: string): Promise<void>
  listChatMessages(agentId: string): Promise<ChatMessage[]>
  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): Promise<void>
  getSettings(): Promise<MeowSettings>
  saveSettings(settings: MeowSettings): Promise<MeowSettings>
  getMcpStatus(): Promise<McpServerStatus[]>
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onAgentState(cb: (e: AgentStateEvent) => void): () => void
  onGitStatus(cb: (e: GitStatusEvent) => void): () => void
  onChatEvent(cb: (e: ChatEvent) => void): () => void
}
