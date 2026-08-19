export type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
export type AlertLevel = 'normal' | 'attention' | 'error'
export type AgentKind = 'pty' | 'native'
export type AgentMode = 'build' | 'plan'
export type ModelVariant = string
export type ChatRole = 'user' | 'assistant'

export interface Template {
  id: string
  name: string
  command: string
  args: string[]
  icon?: string
  kind?: AgentKind
}

export interface AgentConfig {
  id: string
  name: string
  templateId: string
  cwd: string
  kind?: AgentKind
  mode?: AgentMode
  variant?: ModelVariant
  model?: string
  background?: boolean
}

export interface Workspace {
  projectPath: string
  name: string
  agents: AgentConfig[]
}

export interface WorkspaceSummary {
  projectPath: string
  name: string
  agentCount: number
}

export interface GitStatus {
  branch: string | null
  dirtyCount: number
}

export interface AgentState {
  agentId: string
  status: AgentStatus
  exitCode: number | null
  lastOutputAt: number | null
  alert: AlertLevel
}

export interface WorkspaceRuntime {
  workspace: Workspace
  agents: AgentState[]
  git: GitStatus | null
}

export interface NewAgentInput {
  name: string
  templateId: string
  cwd: string
  kind?: AgentKind
  mode?: AgentMode
}

export interface MessageTokens {
  input: number
  output: number
  total: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ContextInfo {
  limit: number | null
  compactThreshold: number | null
  sessionCost: number
}

export interface ImageAttachment {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  size: number
  width?: number
  height?: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  reasoning?: string
  tokens?: MessageTokens
  images?: ImageAttachment[]
  createdAt: number
}

export interface ToolCallData {
  id: string
  tool: string
  input: Record<string, unknown>
  output?: string
  error?: string
  permission: 'pending' | 'allowed' | 'denied'
}

export type ChatTranscriptItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tool'; tool: ToolCallData }

export interface SessionSummary {
  id: string
  agentId: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

export type ChatEvent =
  | { type: 'text-delta'; agentId: string; delta: string }
  | { type: 'reasoning-delta'; agentId: string; delta: string }
  | { type: 'tool-start'; agentId: string; call: ToolCallData }
  | { type: 'tool-result'; agentId: string; call: ToolCallData }
  | { type: 'prompt-request'; agentId: string; promptId: string
      kind: 'permission' | 'question'; call?: ToolCallData; question?: string
      options?: QuestionOption[]; multiple?: boolean; custom?: boolean }
  | { type: 'turn-started'; agentId: string }
  | { type: 'done'; agentId: string; reason: string; tokens?: TokenUsage; cost?: number }
  | { type: 'error'; agentId: string; message: string }
  | { type: 'compacted'; agentId: string; summary: string }
  | { type: 'compaction-failed'; agentId: string }
  | { type: 'usage'; agentId: string; tokens: MessageTokens; sessionCost: number; sessionTokens: { input: number; output: number } }
  | { type: 'todo-updated'; agentId: string; todos: TodoItem[] }
  | { type: 'queue-updated'; agentId: string; queue: QueuedMessage[] }
  | { type: 'subagent-event'; agentId: string; taskId: string
      parentTaskId?: string
      sub: 'start' | 'delta' | 'tool' | 'done'
      subagentType?: string; text?: string; tool?: string
      reasoning?: string; background?: boolean; result?: string
      state?: 'running' | 'completed' | 'cancelled' | 'error' }
  | { type: 'session-created'; agentId: string }

export interface QueuedMessage {
  id: string
  text: string
  images?: ImageAttachment[]
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface TraceSummary {
  sessionId: string
  eventCount: number
  firstTs: number
  lastTs: number
}

export type TraceEvent =
  | { type: 'turn-started'; seq: number; ts: number; agentId: string; sessionId: string; turn: number }
  | { type: 'message'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; role: 'assistant'; text?: string; reasoning?: string; tokens?: MessageTokens; ttftMs?: number; decodeMs?: number; durationMs?: number }
  | { type: 'tool-start'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; callId: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool-result'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; callId: string; tool: string; output?: string; error?: string; durationMs: number; cost?: number }
  | { type: 'subagent'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; taskId: string; parentTaskId?: string; subagentType?: string; state: 'running' | 'completed' | 'cancelled' | 'error'; text?: string; result?: string; tools: string[] }
  | { type: 'compaction'; seq: number; ts: number; agentId: string; sessionId: string; turn: number; summary: string }
  | { type: 'error'; seq: number; ts: number; agentId: string; sessionId: string; message: string }
  | { type: 'done'; seq: number; ts: number; agentId: string; sessionId: string; reason: string; tokens?: TokenUsage; cost?: number }
  | { type: 'pty-run'; seq: number; ts: number; agentId: string; sessionId: string; startTs: number; endTs?: number; exitCode?: number; durationMs?: number; logPath: string }

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionPrompt {
  question: string
  header?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

export interface PromptResponse {
  allow: boolean
  text?: string
  always?: boolean
}

export interface ProviderSettings {
  id: string
  apiKey: string
  baseUrl?: string
  models: string[]
}

export type PermissionRule = 'allow' | 'ask' | 'deny'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

export interface CompactionSettings {
  auto: boolean
  buffer: number
  keepTokens: number
  tailTurns: number
  toolOutputMaxChars: number
  prune?: boolean
}

export interface ToolOutputSettings {
  maxBytes: number
  maxLines: number
}

export interface LspSettings {
  enabled: boolean
  diagnosticsTimeoutMs: number
}

export interface AgentSettings {
  name: string
  systemPrompt: string
  provider?: string
  model?: string
}

export interface MeowSettings {
  providers: ProviderSettings[]
  defaultProvider: string
  agents: AgentSettings[]
  permission: Record<string, PermissionRule>
  mcp: Record<string, McpServerConfig>
  maxContextTokens: number
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  lsp: LspSettings
  notifications?: NotificationsSettings
  trace?: { enabled: boolean }
  /** Model override per sub-agent role. Missing role -> inherit main agent model. */
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
}

export type SubagentType = 'research' | 'general' | 'reviewer'

export interface ModelRef {
  provider: string
  model: string
}

export interface ChatGptWebStatus {
  enabled: boolean
  loggedIn: boolean
  verifiedAt: string | null
}

export interface CatalogProviderSummary {
  id: string
  name: string
  api?: string
  modelCount: number
}

export interface McpServerStatus {
  name: string
  status: 'connected' | 'error'
  error?: string
  tools: string[]
}

export interface Command {
  name: string
  description: string
  template: string
  type?: 'prompt' | 'system'
  agent?: string
  model?: string
}

export interface UsageSummary {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface ModelUsage {
  messages: number
  tokens: number
  cost: number
}

export interface StatsSummary {
  totalCost: number
  totalTokens: number
  perModel: Record<string, ModelUsage>
  perSession: Array<{ id: string; title: string; model: string; usage: UsageSummary }>
}

export interface ContextChangedEvent {
  projectPath: string
  files: string[]
}

export type UpdaterStatusEvent =
  | { type: 'checking' }
  | { type: 'update-available'; version: string; releaseNotes?: string; releaseDate?: string; currentVersion: string }
  | { type: 'up-to-date'; currentVersion: string }
  | { type: 'download-progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'not-supported'; message: string }

export type BackgroundState = 'foreground' | 'background'

export interface FileSuggestion {
  path: string
  name: string
  isDirectory: boolean
}

export interface NotificationsSettings {
  needsInput: boolean
  onDone: boolean
}

export interface TerminalInfo {
  id: string        // "term-<uuid>"
  cwd: string
  name: string      // basename(cwd), tiêu đề pane
  status: 'running' | 'exited'
}
