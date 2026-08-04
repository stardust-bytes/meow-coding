export type AgentStatus = 'spawning' | 'running' | 'idle' | 'exited' | 'stopped' | 'error'
export type AlertLevel = 'normal' | 'attention' | 'error'
export type AgentKind = 'pty' | 'native'
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
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
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

export type ChatEvent =
  | { type: 'text-delta'; agentId: string; delta: string }
  | { type: 'tool-start'; agentId: string; call: ToolCallData }
  | { type: 'tool-result'; agentId: string; call: ToolCallData }
  | { type: 'prompt-request'; agentId: string; promptId: string
      kind: 'permission' | 'question'; call?: ToolCallData; question?: string }
  | { type: 'done'; agentId: string; reason: string }
  | { type: 'error'; agentId: string; message: string }

export interface PromptResponse {
  allow: boolean
  text?: string
}

export interface ProviderSettings {
  id: string
  apiKey: string
  baseUrl?: string
  model: string
}

export interface MeowSettings {
  providers: ProviderSettings[]
  defaultProvider: string
}
