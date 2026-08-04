import { randomUUID } from 'node:crypto'
import type { ChatEvent, ChatMessage, ChatTranscriptItem, McpServerStatus, MeowSettings, PromptResponse, TodoItem } from '../shared/types'
import type { AgentConfig, AgentMode, ModelRef, ModelVariant } from '../shared/types'
import {
  configToSettings, loadMeowConfig, resolveAgentConfig, settingsToConfig, writeMeowConfig,
  type ResolvedAgentConfig
} from './agent/config'
import { SessionRunner } from './agent/loop'
import { createLlm } from './agent/llm'
import type { LlmClient } from './agent/llm'
import { decidePermission } from './agent/permission'
import { SessionStore } from './agent/session'
import type { SessionSummary, StoredSession } from './agent/session'
import { McpManager } from './agent/mcp/manager'
import { collectSkills, skillListText } from './agent/skill'
import { loadUserTools } from './agent/plugin'
import { instructionsText, loadInstructions } from './agent/instructions'
import { expandReferences } from './agent/references'
import { SnapshotStore } from './agent/snapshot'
import { SavedPermissions } from './agent/saved-permissions'
import { revertTool } from './agent/tools/revert'
import { createTaskTool } from './agent/tools/task'
import type { ToolDefinition } from './agent/tools/types'

export interface MeowAgentManagerDeps {
  configPath: string
  store: SessionStore
  tools: Map<string, ToolDefinition>
  createLlm?: (provider: string, apiKey: string, baseUrl?: string) => LlmClient
  env?: NodeJS.ProcessEnv
  userSkillsDir?: string
  userToolsDir?: string
  userInstructionsDir?: string
  snapshots: SnapshotStore
  savedPermissions: SavedPermissions
}

export class MeowAgentManager {
  private runners = new Map<string, SessionRunner>()
  private agents = new Map<string, AgentConfig>()
  private resolved = new Map<string, ResolvedAgentConfig>()
  private controllers = new Map<string, AbortController>()
  private pendingPrompts = new Map<string, { agentId: string; tool?: string; resolve: (resp: PromptResponse | null) => void }>()
  private running = new Set<string>()
  private activeSessions = new Map<string, string>()
  private tools: Map<string, ToolDefinition>
  private modes = new Map<string, AgentMode>()
  private mcp = new McpManager()
  private onEvent: (e: ChatEvent) => void = () => {}

  constructor(private deps: MeowAgentManagerDeps) {
    this.tools = new Map(deps.tools)
  }

  setOnEvent(cb: (e: ChatEvent) => void): void {
    this.onEvent = (e) => {
      if (e.type === 'done' || e.type === 'error') this.running.delete(e.agentId)
      cb(e)
    }
  }

  isNative(agentId: string): boolean {
    return this.agents.has(agentId)
  }

  isRunning(agentId: string): boolean {
    return this.running.has(agentId)
  }

  async init(agents: AgentConfig[]): Promise<void> {
    await this.syncTools()
    for (const agent of agents) {
      if (agent.kind === 'native') this.register(agent)
    }
  }

  addAgent(agent: AgentConfig): void {
    if (agent.kind === 'native') this.register(agent)
  }

  removeAgent(agentId: string): void {
    this.stop(agentId)
    this.runners.delete(agentId)
    this.agents.delete(agentId)
    this.resolved.delete(agentId)
    this.activeSessions.delete(agentId)
    this.deps.snapshots.clear(agentId)
  }

  private summary(session: StoredSession): SessionSummary {
    return {
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      messageCount: session.items.length,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }
  }

  private activeSessionId(agentId: string): string {
    const existing = this.activeSessions.get(agentId)
    if (existing && this.deps.store.get(existing)) return existing
    const latest = this.deps.store.latest(agentId)
    const id = latest?.id ?? this.deps.store.create(agentId, this.agents.get(agentId)?.cwd ?? '').id
    this.activeSessions.set(agentId, id)
    return id
  }

  listSessions(agentId: string): SessionSummary[] {
    return this.deps.store.list(agentId)
  }

  createSession(agentId: string): SessionSummary {
    this.stop(agentId)
    const session = this.deps.store.create(agentId, this.agents.get(agentId)?.cwd ?? '')
    this.activeSessions.set(agentId, session.id)
    return this.summary(session)
  }

  switchSession(agentId: string, sessionId: string): SessionSummary | null {
    const session = this.deps.store.get(sessionId)
    if (!session || session.agentId !== agentId) return null
    this.stop(agentId)
    this.activeSessions.set(agentId, sessionId)
    this.deps.store.touch(sessionId)
    return this.summary(session)
  }

  deleteSession(agentId: string, sessionId: string): SessionSummary {
    const wasActive = this.activeSessions.get(agentId) === sessionId
    this.deps.store.delete(sessionId)
    let next: StoredSession
    if (wasActive) {
      next = this.deps.store.latest(agentId) ?? this.deps.store.create(agentId, this.agents.get(agentId)?.cwd ?? '')
    } else {
      next = this.deps.store.get(this.activeSessions.get(agentId) ?? '')
        ?? this.deps.store.create(agentId, this.agents.get(agentId)?.cwd ?? '')
    }
    this.activeSessions.set(agentId, next.id)
    return this.summary(next)
  }

  async send(agentId: string, text: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) return

    this.deps.store.appendMessage(this.activeSessionId(agentId), {
      id: randomUUID(),
      role: 'user',
      text: expandReferences(agent.cwd, text),
      createdAt: Date.now()
    })
    const config = this.resolved.get(agentId)
    if (!config?.apiKey) {
      this.emit({
        type: 'error',
        agentId,
        message:
          '[meow] Chưa cấu hình provider/API key. Mở Settings, thêm provider (id + API key + models) rồi thử lại.'
      })
      return
    }

    const runner = this.runners.get(agentId)
    if (!runner) return
    const controller = new AbortController()
    this.controllers.set(agentId, controller)
    this.running.add(agentId)
    try {
      await runner.run(controller.signal)
    } finally {
      this.running.delete(agentId)
      this.controllers.delete(agentId)
      this.resolvePendingFor(agentId, null)
    }
  }

  stop(agentId: string): void {
    this.controllers.get(agentId)?.abort()
    this.controllers.delete(agentId)
    this.running.delete(agentId)
    this.resolvePendingFor(agentId, null)
  }

  stopAll(): void {
    for (const id of [...this.controllers.keys()]) this.stop(id)
  }

  newSession(agentId: string): SessionSummary {
    return this.createSession(agentId)
  }

  listMessages(agentId: string): ChatMessage[] {
    const session = this.deps.store.get(this.activeSessionId(agentId))
    if (!session) return []
    return session.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
  }

  listTranscript(agentId: string): ChatTranscriptItem[] {
    return this.deps.store.transcript(this.activeSessionId(agentId))
  }

  getTodos(agentId: string): TodoItem[] {
    return this.deps.store.todos(this.activeSessionId(agentId))
  }

  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): void {
    const entry = this.pendingPrompts.get(promptId)
    if (entry && entry.agentId === agentId) {
      this.pendingPrompts.delete(promptId)
      if (resp.always && resp.allow && entry.tool) {
        const agent = this.agents.get(agentId)
        if (agent) this.deps.savedPermissions.save(agent.cwd, entry.tool)
      }
      entry.resolve(resp)
    }
  }

  setMode(agentId: string, mode: AgentMode): void {
    this.modes.set(agentId, mode)
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.mode = mode
      this.agents.set(agentId, agent)
      if (!this.running.has(agentId)) {
        this.runners.delete(agentId)
        this.resolved.delete(agentId)
        this.register(agent)
      }
    }
  }

  setVariant(agentId: string, variant: ModelVariant): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.variant = variant
      this.agents.set(agentId, agent)
      if (!this.running.has(agentId)) {
        this.runners.delete(agentId)
        this.resolved.delete(agentId)
        this.register(agent)
      }
    }
  }

  setModel(agentId: string, provider: string, model: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.model = `${provider}/${model}`
    this.agents.set(agentId, agent)
    if (!this.running.has(agentId)) {
      this.runners.delete(agentId)
      this.resolved.delete(agentId)
      this.register(agent)
    }
  }

  getAgentModel(agentId: string): ModelRef | null {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    if (!resolved.provider || !resolved.model) return null
    return { provider: resolved.provider, model: resolved.model }
  }

  getProviderModels(): ModelRef[] {
    const cfg = loadMeowConfig(this.deps.configPath)
    const refs: ModelRef[] = []
    for (const [provider, p] of Object.entries(cfg.provider)) {
      for (const model of p.models) refs.push({ provider, model })
    }
    return refs
  }

  getSettings(): MeowSettings {
    return configToSettings(loadMeowConfig(this.deps.configPath))
  }

  getMcpStatus(): McpServerStatus[] {
    return this.mcp.status()
  }

  async saveSettings(settings: MeowSettings): Promise<MeowSettings> {
    const current = loadMeowConfig(this.deps.configPath)
    const cfg = settingsToConfig(settings, current)
    writeMeowConfig(this.deps.configPath, cfg)
    await this.reload()
    return configToSettings(cfg)
  }

  async reload(): Promise<void> {
    const agents = [...this.agents.values()]
    for (const id of [...this.runners.keys()]) {
      this.stop(id)
      this.runners.delete(id)
      this.resolved.delete(id)
    }
    await this.syncTools()
    for (const agent of agents) this.register(agent)
  }

  async dispose(): Promise<void> {
    this.stopAll()
    await this.mcp.closeAll()
  }

  private async syncTools(): Promise<void> {
    const cfg = loadMeowConfig(this.deps.configPath)
    await this.mcp.connect(cfg.mcp ?? {})
    const userTools = await loadUserTools(
      [this.deps.userToolsDir].filter((d): d is string => Boolean(d))
    )
    this.tools = new Map([
      ...this.deps.tools,
      ...userTools.map(t => [t.name, t] as const),
      ...this.mcp.getTools()
    ])
  }

  private register(agent: AgentConfig): void {
    this.agents.set(agent.id, agent)
    if (this.runners.has(agent.id)) return
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    this.resolved.set(agent.id, resolved)
    const skills = collectSkills(agent.cwd, this.deps.userSkillsDir)
    const instructions = instructionsText(loadInstructions(agent.cwd, this.deps.userInstructionsDir))
    const llmClient = (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)
    const taskTool = createTaskTool({ llm: llmClient, model: resolved.model, tools: this.tools })
    const runnerTools = new Map<string, ToolDefinition>([...this.tools])
    runnerTools.set('task', taskTool)
    runnerTools.set('revert', revertTool)
    const mode = agent.mode ?? 'build'
    this.modes.set(agent.id, mode)
    const modeNote = mode === 'plan'
      ? '\n\nYou are in PLAN MODE: read-only analysis. Do NOT create, edit, or delete files. ' +
        'write/edit/apply-patch/revert/git/todowrite tools are unavailable, and do NOT use the bash tool ' +
        'to modify the filesystem either. Produce a plan or analysis instead.'
      : ''
    const runner = new SessionRunner({
      agentId: agent.id,
      model: resolved.model,
      system: resolved.systemPrompt + modeNote + instructions + skillListText(skills),
      cwd: agent.cwd,
      llm: llmClient,
      tools: runnerTools,
      decidePermission: (tool) => decidePermission(
        this.modes.get(agent.id) ?? 'build',
        cfg.permission,
        (t) => this.deps.savedPermissions.isAllowed(agent.cwd, t),
        tool
      ),
      ask: (promptId, tool) => this.awaitPrompt(agent.id, promptId, tool),
      maxContextChars: cfg.maxContextChars,
      snapshots: this.deps.snapshots,
      onEvent: (e) => this.emit(e),
      getItems: () => this.deps.store.get(this.activeSessionId(agent.id))?.items ?? [],
      appendMessage: (msg) => this.deps.store.appendMessage(this.activeSessionId(agent.id), msg),
      appendTool: (tool) => this.deps.store.appendTool(this.activeSessionId(agent.id), tool),
      setTodos: (todos) => {
        this.deps.store.setTodos(this.activeSessionId(agent.id), todos)
        this.emit({ type: 'todo-updated', agentId: agent.id, todos })
      },
      variant: agent.variant
    })
    this.runners.set(agent.id, runner)
  }

  private awaitPrompt(agentId: string, promptId: string, tool?: string): Promise<PromptResponse | null> {
    return new Promise(resolve => {
      this.pendingPrompts.set(promptId, { agentId, tool, resolve })
      if (this.controllers.get(agentId)?.signal.aborted) {
        this.pendingPrompts.delete(promptId)
        resolve(null)
      }
    })
  }

  private resolvePendingFor(agentId: string, resp: PromptResponse | null): void {
    for (const [id, entry] of this.pendingPrompts) {
      if (entry.agentId !== agentId) continue
      entry.resolve(resp)
      this.pendingPrompts.delete(id)
    }
  }

  private emit(e: ChatEvent): void {
    this.onEvent(e)
  }
}
