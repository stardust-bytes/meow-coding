import type {
  AgentConfig, AgentState, ArtifactEntry, CatalogProviderSummary, ChatEvent, ChatMessage, ChatTranscriptItem, Command,
  ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload,
  GitActionResult, GitBlameLine, GitBranch, GitCommit, GitDiffResult, GitStatus, GitStatusDetail,
  ImageAttachment, LogLevel, McpServerStatus, MeowSettings, ModelRef, NewAgentInput, PendingPromptInfo, PromptResponse,
  SessionSummary, StatsSummary, Template, TerminalInfo, TodoItem, TraceEvent, TraceSummary, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
} from './types'
import type { BrowserStatusInfo, PairingInfo } from './browser-types'
import type { RemoteStatus } from './remote-types'

export const Channels = {
  WorkspaceList: 'workspace:list',
  WorkspaceAdd: 'workspace:add',
  WorkspaceRemove: 'workspace:remove',
  WorkspaceOpen: 'workspace:open',
  ProjectOpenFolder: 'project:open-folder',
  ProjectOpenInEditor: 'project:open-in-editor',
  FileOpen: 'file:open',
  FileViewerGetContent: 'file-viewer:get-content',
  FileViewerOpenInEditor: 'file-viewer:open-in-editor',
  FileViewerShowInFolder: 'file-viewer:show-in-folder',
  GitOpenViewer: 'git:open-viewer',
  GitGetBranches: 'git:get-branches',
  GitCreateBranch: 'git:create-branch',
  GitCheckout: 'git:checkout',
  GitStash: 'git:stash',
  GitStashPop: 'git:stash-pop',
  GitDiscard: 'git:discard',
  GitStatusDetail: 'git:status-detail',
  GitGetDiff: 'git:get-diff',
  GitGetCommits: 'git:get-commits',
  GitGetCommitDiff: 'git:get-commit-diff',
  GitCompareCommits: 'git:compare-commits',
  GitGetBlame: 'git:get-blame',
  GitGetFileHistory: 'git:get-file-history',
  AgentAdd: 'agent:add',
  AgentRemove: 'agent:remove',
  AgentSetMode: 'agent:set-mode',
  AgentSetVariant: 'agent:set-variant',
  AgentGetVariants: 'agent:get-variants',
  AgentSetModel: 'agent:set-model',
  AgentGetModel: 'agent:get-model',
  AgentGetContext: 'agent:get-context',
  ProviderModels: 'provider:models',
  ProviderFetchModels: 'provider:fetch-models',
  ProviderCatalog: 'provider:catalog',
  ProviderConnect: 'provider:connect',
  ProviderDisconnect: 'provider:disconnect',
  ConnectionList: 'connections:list',
  ConnectionConnectCodex: 'connections:connect-codex',
  ConnectionDisconnect: 'connections:disconnect',
  ConnectionSetActive: 'connections:set-active',
  ConnectionGetModels: 'connections:get-models',
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
  SystemLog: 'system-log:write',
  AppQuit: 'app:quit',
  AppVersion: 'app:version',
  UpdaterCheck: 'updater:check',
  UpdaterInstall: 'updater:install',
  EventUpdaterStatus: 'updater:status',
  ChatSend: 'chat:send',
  ChatStop: 'chat:stop',
  ChatRunCommand: 'chat:run-command',
  ChatUndo: 'chat:undo',
  ChatRedo: 'chat:redo',
  ChatNewSession: 'chat:new-session',
  ChatListMessages: 'chat:list-messages',
  ChatListTranscript: 'chat:list-transcript',
  ChatGetTodos: 'chat:get-todos',
  ChatIsRunning: 'chat:is-running',
  ChatGetPendingPrompt: 'chat:get-pending-prompt',
  ChatRespondPrompt: 'chat:respond-prompt',
  PromptStatesList: 'prompt:states-list',
  EventPromptState: 'prompt:state-changed',
  EventActivateAgent: 'agent:activate',
  ChatQueueRemove: 'chat:queue-remove',
  ChatQueueEdit: 'chat:queue-edit',
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
  McpReconnect: 'mcp:reconnect',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',
  WindowSetTheme: 'window:set-theme',
  EventWindowMaximizedChange: 'window:maximized-change',
  TerminalOpen: 'terminal:open',
  TerminalClose: 'terminal:close',
  SystemTerminalOpen: 'system-terminal:open',
  EventTerminalExit: 'terminal:exit',
  EventPtyData: 'pty:data',
  EventAgentState: 'agent:state',
  EventGitStatus: 'git:status',
  EventContextChanged: 'context:changed',
  EventChat: 'chat:event',
  FilesSuggest: 'files:suggest',
  AgentSetBackground: 'agent:set-background',
  EventAgentBackground: 'agent:background',
  EventAgentConfig: 'agent:config-changed',
  BrowserGetStatus: 'browser:get-status',
  BrowserPair: 'browser:pair',
  BrowserOpenInstallGuide: 'browser:open-install-guide',
  BrowserOpenExtensionFolder: 'browser:open-extension-folder',
  BrowserOpenChromeExtensions: 'browser:open-chrome-extensions',
  BrowserGetConsoleLogs: 'browser:get-console-logs',
  BrowserGetNetworkLogs: 'browser:get-network-logs',
  EventBrowserStatus: 'browser:status',
  RemoteGetStatus: 'remote:get-status',
  RemoteSetEnabled: 'remote:set-enabled',
  RemoteSetRelayUrl: 'remote:set-relay-url',
  RemoteStartPairing: 'remote:start-pairing',
  RemoteRevokeToken: 'remote:revoke-token',
  EventRemoteStatus: 'remote:status',
  EventBrowserOpenInstallGuide: 'browser:install-guide',
  TraceList: 'trace:list',
  TraceRead: 'trace:read',
  TraceDelete: 'trace:delete',
  EventTrace: 'trace:event',
  DirList: 'dir:list',
  ArtifactsList: 'artifacts:list',
  ArtifactsClear: 'artifacts:clear',
  EventArtifactsChanged: 'artifacts:changed'
} as const

export interface PtyDataEvent { agentId: string; data: string }
export interface TerminalExitEvent { id: string; exitCode: number | null }
export interface AgentStateEvent { agentId: string; state: AgentState }
export interface GitStatusEvent { projectPath: string; git: GitStatus | null }
export interface AgentConfigEvent { agentId: string; config: AgentConfig }
export interface WindowMaximizedChangeEvent { maximized: boolean }
export type BrowserStatusEvent = BrowserStatusInfo

export interface BrowserInstallGuideEvent {
  extensionDir: string
}

export interface ArtifactsChangedEvent {
  projectPath: string
  artifacts: ArtifactEntry[]
}

/** One agent in a project currently waiting on a permission/question prompt. */
export interface PromptStateSummary {
  projectPath: string
  agentIds: string[]
}

/** Fired when an agent starts (pending=true) or stops (pending=false) waiting on user input. */
export interface PromptStateEvent {
  projectPath: string
  agentId: string
  pending: boolean
}

/** Fired when the user clicks an OS notification for an agent needing input; navigates to it. */
export interface ActivateAgentEvent {
  projectPath: string
  agentId: string
}

export interface AgentApi {
  listWorkspaces(): Promise<WorkspaceSummary[]>
  addWorkspace(projectPath: string, name: string): Promise<WorkspaceRuntime | null>
  removeWorkspace(projectPath: string): Promise<void>
  openWorkspace(projectPath: string): Promise<WorkspaceRuntime>
  openInEditor(projectPath: string): Promise<void>
  openFolder(projectPath: string): Promise<void>
  openFile(payload: FileViewerPayload): Promise<void>
  getFileContent(path: string): Promise<FileContentResult>
  openFileInEditor(path: string): Promise<void>
  showFileInFolder(path: string): Promise<void>
  gitOpenViewer(projectPath: string): Promise<void>
  gitGetBranches(projectPath: string): Promise<GitBranch[]>
  gitCreateBranch(projectPath: string, name: string, base: string): Promise<GitActionResult>
  gitCheckout(projectPath: string, branch: string): Promise<GitActionResult>
  gitStash(projectPath: string): Promise<GitActionResult>
  gitStashPop(projectPath: string): Promise<GitActionResult>
  gitDiscard(projectPath: string): Promise<GitActionResult>
  gitGetStatusDetail(projectPath: string): Promise<GitStatusDetail | null>
  gitGetDiff(projectPath: string, file?: string, staged?: boolean): Promise<string>
  gitGetCommits(projectPath: string, file?: string, count?: number): Promise<GitCommit[]>
  gitGetCommitDiff(projectPath: string, sha: string): Promise<GitDiffResult>
  gitCompareCommits(projectPath: string, a: string, b: string): Promise<GitDiffResult>
  gitGetBlame(projectPath: string, file: string): Promise<GitBlameLine[]>
  gitGetFileHistory(projectPath: string, file: string): Promise<GitCommit[]>
  listDir(absPath: string): Promise<DirEntry[]>
  listArtifacts(projectPath: string): Promise<ArtifactEntry[]>
  clearArtifacts(projectPath: string): Promise<void>
  onArtifactsChanged(cb: (e: ArtifactsChangedEvent) => void): () => void
  openTerminal(cwd: string): Promise<TerminalInfo>
  closeTerminal(id: string): Promise<void>
  openSystemTerminal(cwd: string): Promise<void>
  addAgent(projectPath: string, input: NewAgentInput): Promise<WorkspaceRuntime>
  removeAgent(projectPath: string, agentId: string): Promise<void>
  setAgentMode(agentId: string, mode: 'build' | 'plan'): Promise<void>
  setAgentVariant(agentId: string, variant: string | null): Promise<void>
  getAgentVariants(agentId: string): Promise<string[]>
  setAgentModel(agentId: string, model: ModelRef): Promise<void>
  getAgentModel(agentId: string): Promise<ModelRef | null>
  getContextInfo(agentId: string): Promise<ContextInfo>
  getProviderModels(): Promise<ModelRef[]>
  fetchProviderModels(providerId: string): Promise<string[]>
  listProviderCatalog(): Promise<CatalogProviderSummary[]>
  connectProvider(providerId: string, apiKey: string, baseUrl?: string, models?: string[], providerType?: string): Promise<MeowSettings>
  disconnectProvider(providerId: string): Promise<MeowSettings>
  listConnections(): Promise<ConnectionAccount[]>
  connectCodex(): Promise<ConnectionAccount>
  disconnectConnection(accountId: string): Promise<ConnectionAccount[]>
  setActiveConnection(accountId: string): Promise<ConnectionAccount[]>
  getConnectionModels(): Promise<ModelRef[]>
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
  writeSystemLog(level: LogLevel, message: string): Promise<void>
  quit(): Promise<void>
  getAppVersion(): Promise<string>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  sendChat(agentId: string, text: string, images?: ImageAttachment[]): Promise<void>
  stopChat(agentId: string): Promise<void>
  suggestFiles(agentId: string, prefix: string): Promise<FileSuggestion[]>
  setAgentBackground(agentId: string, background: boolean): Promise<void>
  onAgentBackground(cb: (e: { agentId: string; background: boolean }) => void): () => void
  runCommand(agentId: string, name: string, args: string): Promise<void>
  undoChat(agentId: string): Promise<boolean>
  redoChat(agentId: string): Promise<boolean>
  newChatSession(agentId: string): Promise<SessionSummary>
  listChatMessages(agentId: string): Promise<ChatMessage[]>
  listChatTranscript(agentId: string): Promise<ChatTranscriptItem[]>
  getChatTodos(agentId: string): Promise<TodoItem[]>
  isChatRunning(agentId: string): Promise<boolean>
  getPendingPrompt(agentId: string): Promise<PendingPromptInfo | null>
  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): Promise<void>
  listPromptStates(): Promise<PromptStateSummary[]>
  onPromptState(cb: (e: PromptStateEvent) => void): () => void
  onActivateAgent(cb: (e: ActivateAgentEvent) => void): () => void
  removeQueued(agentId: string, id: string): Promise<void>
  editQueued(agentId: string, id: string, text: string): Promise<void>
  listSessions(agentId: string): Promise<SessionSummary[]>
  createSession(agentId: string): Promise<SessionSummary>
  switchSession(agentId: string, sessionId: string): Promise<SessionSummary | null>
  deleteSession(agentId: string, sessionId: string): Promise<SessionSummary>
  renameSession(agentId: string, sessionId: string, title: string): Promise<SessionSummary | null>
  traceList(agentId: string): Promise<TraceSummary[]>
  traceRead(sessionId: string): Promise<TraceEvent[]>
  traceDelete(sessionId: string): Promise<void>
  onTraceEvent(cb: (e: TraceEvent) => void): () => void
  getSettings(): Promise<MeowSettings>
  saveSettings(settings: MeowSettings): Promise<MeowSettings>
  listCommands(projectPath: string): Promise<Command[]>
  saveCommand(command: Command): Promise<Command>
  removeCommand(name: string): Promise<void>
  getStats(): Promise<StatsSummary>
  getMcpStatus(): Promise<McpServerStatus[]>
  reconnectMcp(): Promise<McpServerStatus[]>
  platform: string
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  setTitleBarTheme(theme: 'dark' | 'light'): Promise<void>
  onWindowMaximizedChange(cb: (e: WindowMaximizedChangeEvent) => void): () => void
  onUpdaterStatus(cb: (e: UpdaterStatusEvent) => void): () => void
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onTerminalExit(cb: (e: TerminalExitEvent) => void): () => void
  onAgentState(cb: (e: AgentStateEvent) => void): () => void
  onAgentConfig(cb: (e: AgentConfigEvent) => void): () => void
  onGitStatus(cb: (e: GitStatusEvent) => void): () => void
  onContextChanged(cb: (e: ContextChangedEvent) => void): () => void
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  getBrowserStatus(): Promise<BrowserStatusInfo>
  pairBrowser(): Promise<PairingInfo>
  openBrowserInstallGuide(): Promise<void>
  openBrowserExtensionFolder(): Promise<void>
  openBrowserChromeExtensions(): Promise<void>
  getBrowserConsoleLogs(limit?: number): Promise<unknown[]>
  getBrowserNetworkLogs(limit?: number): Promise<unknown[]>
  onBrowserStatus(cb: (info: BrowserStatusInfo) => void): () => void
  getRemoteStatus(): Promise<RemoteStatus>
  setRemoteEnabled(enabled: boolean): Promise<void>
  setRemoteRelayUrl(url: string): Promise<void>
  startRemotePairing(): Promise<{ code: string; expiresAt: number } | null>
  revokeRemoteToken(): Promise<void>
  onRemoteStatus(cb: (s: RemoteStatus) => void): () => void
  onBrowserOpenInstallGuide(cb: (e: BrowserInstallGuideEvent) => void): () => void
}
