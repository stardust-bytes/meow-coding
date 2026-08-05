import type {
  AgentState, CatalogProviderSummary, ChatEvent, ChatMessage, ChatTranscriptItem, Command, ContextChangedEvent,
  GitStatus, McpServerStatus, MeowSettings, ModelRef, NewAgentInput, PromptResponse, SessionSummary,
  StatsSummary, Template, TodoItem, WorkspaceRuntime, WorkspaceSummary
} from './types'

export const Channels = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  WorkspaceOpen: 'workspace:open',
  ProjectOpenInEditor: 'project:open-in-editor',
  AgentAdd: 'agent:add',
  AgentRemove: 'agent:remove',
  AgentSetMode: 'agent:set-mode',
  AgentSetVariant: 'agent:set-variant',
  AgentSetModel: 'agent:set-model',
  AgentGetModel: 'agent:get-model',
  ProviderModels: 'provider:models',
  ProviderFetchModels: 'provider:fetch-models',
  ProviderCatalog: 'provider:catalog',
  ProviderConnect: 'provider:connect',
  ProviderDisconnect: 'provider:disconnect',
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
  ChatRunCommand: 'chat:run-command',
  ChatUndo: 'chat:undo',
  ChatRedo: 'chat:redo',
  ChatNewSession: 'chat:new-session',
  ChatListMessages: 'chat:list-messages',
  ChatListTranscript: 'chat:list-transcript',
  ChatGetTodos: 'chat:get-todos',
  ChatRespondPrompt: 'chat:respond-prompt',
  SessionList: 'session:list',
  SessionCreate: 'session:create',
  SessionSwitch: 'session:switch',
  SessionDelete: 'session:delete',
  SessionRename: 'session:rename',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',
  CommandList: 'commands:list',
  CommandSave: 'commands:save',
  CommandRemove: 'commands:remove',
  StatsGet: 'stats:get',
  McpStatus: 'mcp:status',
  EventPtyData: 'pty:data',
  EventAgentState: 'agent:state',
  EventGitStatus: 'git:status',
  EventContextChanged: 'context:changed',
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
  openInEditor(projectPath: string): Promise<void>
  addAgent(projectPath: string, input: NewAgentInput): Promise<WorkspaceRuntime>
  removeAgent(projectPath: string, agentId: string): Promise<void>
  setAgentMode(agentId: string, mode: 'build' | 'plan'): Promise<void>
  setAgentVariant(agentId: string, variant: 'medium' | 'high' | 'max'): Promise<void>
  setAgentModel(agentId: string, provider: string, model: string): Promise<void>
  getAgentModel(agentId: string): Promise<ModelRef | null>
  getProviderModels(): Promise<ModelRef[]>
  fetchProviderModels(providerId: string): Promise<string[]>
  listProviderCatalog(): Promise<CatalogProviderSummary[]>
  connectProvider(providerId: string, apiKey: string, baseUrl?: string): Promise<MeowSettings>
  disconnectProvider(providerId: string): Promise<MeowSettings>
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
  runCommand(agentId: string, name: string, args: string[]): Promise<void>
  undoChat(agentId: string): Promise<boolean>
  redoChat(agentId: string): Promise<boolean>
  newChatSession(agentId: string): Promise<SessionSummary>
  listChatMessages(agentId: string): Promise<ChatMessage[]>
  listChatTranscript(agentId: string): Promise<ChatTranscriptItem[]>
  getChatTodos(agentId: string): Promise<TodoItem[]>
  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): Promise<void>
  listSessions(agentId: string): Promise<SessionSummary[]>
  createSession(agentId: string): Promise<SessionSummary>
  switchSession(agentId: string, sessionId: string): Promise<SessionSummary | null>
  deleteSession(agentId: string, sessionId: string): Promise<SessionSummary>
  renameSession(agentId: string, sessionId: string, title: string): Promise<SessionSummary | null>
  getSettings(): Promise<MeowSettings>
  saveSettings(settings: MeowSettings): Promise<MeowSettings>
  listCommands(projectPath: string): Promise<Command[]>
  saveCommand(command: Command): Promise<Command>
  removeCommand(name: string): Promise<void>
  getStats(): Promise<StatsSummary>
  getMcpStatus(): Promise<McpServerStatus[]>
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onAgentState(cb: (e: AgentStateEvent) => void): () => void
  onGitStatus(cb: (e: GitStatusEvent) => void): () => void
  onContextChanged(cb: (e: ContextChangedEvent) => void): () => void
  onChatEvent(cb: (e: ChatEvent) => void): () => void
}
