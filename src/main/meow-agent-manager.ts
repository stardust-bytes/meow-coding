import { randomUUID } from 'node:crypto'
import type { ChatEvent, ChatMessage, MeowSettings, PromptResponse } from '../shared/types'
import type { AgentConfig } from '../shared/types'
import {
  configToSettings, loadMeowConfig, resolveAgentConfig, settingsToConfig, writeMeowConfig,
  type ResolvedAgentConfig
} from './agent/config'
import { SessionRunner } from './agent/loop'
import { createLlm } from './agent/llm'
import type { LlmClient } from './agent/llm'
import { decidePermission } from './agent/permission'
import { SessionStore } from './agent/session'
import { McpManager } from './agent/mcp/manager'
import { collectSkills, skillListText } from './agent/skill'
import { loadUserTools } from './agent/plugin'
import type { ToolDefinition } from './agent/tools/types'

export interface MeowAgentManagerDeps {
  configPath: string
  store: SessionStore
  tools: Map<string, ToolDefinition>
  createLlm?: (provider: string, apiKey: string, baseUrl?: string) => LlmClient
  env?: NodeJS.ProcessEnv
  userSkillsDir?: string
  userToolsDir?: string
}

export class MeowAgentManager {
  private runners = new Map<string, SessionRunner>()
  private agents = new Map<string, AgentConfig>()
  private resolved = new Map<string, ResolvedAgentConfig>()
  private controllers = new Map<string, AbortController>()
  private pendingPrompts = new Map<string, { agentId: string; resolve: (resp: PromptResponse | null) => void }>()
  private running = new Set<string>()
  private tools: Map<string, ToolDefinition>
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
  }

  async send(agentId: string, text: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) return

    this.deps.store.appendMessage(agentId, {
      id: randomUUID(),
      role: 'user',
      text,
      createdAt: Date.now()
    })
    const config = this.resolved.get(agentId)
    if (!config?.apiKey) {
      const provider = config?.provider ?? 'anthropic'
      this.emit({
        type: 'error',
        agentId,
        message:
          '[meow] Chưa cấu hình API key. Đặt biến môi trường ' +
          `(VD: ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}) ` +
          'hoặc tạo file meow.json trong thư mục dữ liệu ứng dụng.'
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

  newSession(agentId: string): void {
    this.stop(agentId)
    this.deps.store.clear(agentId)
  }

  listMessages(agentId: string): ChatMessage[] {
    const session = this.deps.store.get(agentId)
    if (!session) return []
    return session.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
  }

  respondPrompt(agentId: string, promptId: string, resp: PromptResponse): void {
    const entry = this.pendingPrompts.get(promptId)
    if (entry && entry.agentId === agentId) {
      this.pendingPrompts.delete(promptId)
      entry.resolve(resp)
    }
  }

  getSettings(): MeowSettings {
    return configToSettings(loadMeowConfig(this.deps.configPath))
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
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env)
    this.resolved.set(agent.id, resolved)
    const skills = collectSkills(agent.cwd, this.deps.userSkillsDir)
    const runner = new SessionRunner({
      agentId: agent.id,
      model: resolved.model,
      system: resolved.systemPrompt + skillListText(skills),
      cwd: agent.cwd,
      llm: (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl),
      tools: this.tools,
      decidePermission: (tool) => decidePermission(cfg.permission, tool),
      ask: (promptId) => this.awaitPrompt(agent.id, promptId),
      onEvent: (e) => this.emit(e),
      getItems: () => this.deps.store.get(agent.id)?.items ?? [],
      appendMessage: (msg) => this.deps.store.appendMessage(agent.id, msg),
      appendTool: (tool) => this.deps.store.appendTool(agent.id, tool)
    })
    this.runners.set(agent.id, runner)
  }

  private awaitPrompt(agentId: string, promptId: string): Promise<PromptResponse | null> {
    return new Promise(resolve => {
      this.pendingPrompts.set(promptId, { agentId, resolve })
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
