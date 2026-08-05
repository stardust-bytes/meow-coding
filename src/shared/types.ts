export type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
export type AlertLevel = 'normal' | 'attention' | 'error'
export type AgentKind = 'pty' | 'native'
export type AgentMode = 'build' | 'plan'
export type ModelVariant = 'medium' | 'high' | 'max'
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

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  reasoning?: string
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
  | { type: 'done'; agentId: string; reason: string; tokens?: TokenUsage; cost?: number }
  | { type: 'error'; agentId: string; message: string }
  | { type: 'compacted'; agentId: string; summary: string }
  | { type: 'todo-updated'; agentId: string; todos: TodoItem[] }
  | { type: 'subagent-event'; agentId: string; taskId: string
      sub: 'start' | 'delta' | 'tool' | 'done'
      subagentType?: string; text?: string; tool?: string
      state?: 'running' | 'completed' | 'cancelled' | 'error' }

export interface TokenUsage {
  input: number
  output: number
  total: number
}

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
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  lsp: LspSettings
}

export interface ModelRef {
  provider: string
  model: string
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
