export type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
export type AlertLevel = 'normal' | 'attention' | 'error'
export type AgentKind = 'pty' | 'native'
export type AgentMode = 'build' | 'plan'
export type ModelVariant = 'low' | 'medium' | 'high' | 'max'
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
  | { type: 'done'; agentId: string; reason: string; tokens?: TokenUsage }
  | { type: 'error'; agentId: string; message: string }
  | { type: 'todo-updated'; agentId: string; todos: TodoItem[] }

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

export interface MeowSettings {
  providers: ProviderSettings[]
  defaultProvider: string
}

export interface ModelRef {
  provider: string
  model: string
}

export interface McpServerStatus {
  name: string
  status: 'connected' | 'error'
  error?: string
  tools: string[]
}
