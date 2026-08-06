import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { ChatEvent, ChatMessage, ChatTranscriptItem, ContextInfo, ImageAttachment, McpServerStatus, MeowSettings, ModelUsage, PromptResponse, StatsSummary, TodoItem, UsageSummary } from '../shared/types'
import type { AgentConfig, AgentMode, CatalogProviderSummary, Command, ModelRef } from '../shared/types'
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
import type { SnapshotTurn } from './agent/snapshot'
import { TruncationStore } from './agent/truncation'
import { CommandStore, uniqueCommands, projectCommands, resolveCommand } from './agent/commands'
import { calcCost, EMPTY_USAGE } from './agent/usage'
import type { ModelPrice } from './agent/usage'
import { LspManager } from './agent/lsp/manager'
import { createLspTool } from './agent/tools/lsp'
import { SavedPermissions } from './agent/saved-permissions'
import { ModelsCatalog } from './models-catalog'
import type { VariantBody } from './model-variants'
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
  builtinSkillsDir?: string
  snapshots: SnapshotStore
  savedPermissions: SavedPermissions
  catalog?: ModelsCatalog
  truncation: TruncationStore
  commands?: CommandStore
  prices?: Record<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>
  projectPath?: string
  lsp?: LspManager
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
  private modelLimits = new Map<string, { context?: number; output?: number }>()
  private modelVariants = new Map<string, Record<string, VariantBody>>()
  private redoStacks = new Map<string, Array<{ items: ChatTranscriptItem[]; turn: SnapshotTurn }>>()
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

  setProjectPath(projectPath: string): void {
    this.deps = { ...this.deps, projectPath }
  }

  isNative(agentId: string): boolean {
    return this.agents.has(agentId)
  }

  isRunning(agentId: string): boolean {
    return this.running.has(agentId)
  }

  async init(agents: AgentConfig[]): Promise<void> {
    await this.syncTools()
    await this.refreshModelLimits()
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
    this.deps.store.deleteForAgent(agentId)
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

  async send(agentId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) return

    this.deps.store.appendMessage(this.activeSessionId(agentId), {
      id: randomUUID(),
      role: 'user',
      text: expandReferences(agent.cwd, text),
      images,
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
    this.redoStacks.delete(agentId)
    this.deps.snapshots.beginTurn(agentId)
    try {
      await runner.run(controller.signal)
    } finally {
      this.deps.snapshots.commitTurn(agentId)
      this.running.delete(agentId)
      this.controllers.delete(agentId)
      this.resolvePendingFor(agentId, null)
    }
  }

  // Undoes the last completed turn: restores pre-turn file contents and drops
  // the turn's transcript items. Returns true if a turn was undone.
  undo(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    this.stop(agentId)
    const turn = this.deps.snapshots.undo(agentId)
    if (!turn) return false
    const sessionId = this.activeSessionId(agentId)
    const removed = this.deps.store.truncateFromLastUser(sessionId)
    if (removed.length > 0) {
      const stack = this.redoStacks.get(agentId) ?? []
      stack.push({ items: removed, turn })
      this.redoStacks.set(agentId, stack)
    }
    return true
  }

  // Re-applies a previously undone turn: restores the post-turn file contents
  // and re-inserts the removed transcript items.
  redo(agentId: string): boolean {
    const stack = this.redoStacks.get(agentId)
    const entry = stack?.pop()
    if (!entry) return false
    if (stack && stack.length === 0) this.redoStacks.delete(agentId)
    const { items, turn } = entry
    for (const [filePath, content] of Object.entries(turn.after)) {
      try {
        writeFileSync(filePath, content)
      } catch {
        /* file may be missing */
      }
    }
    this.deps.snapshots.pushTurn(turn)
    const sessionId = this.activeSessionId(agentId)
    for (const item of items) {
      if (item.kind === 'message') this.deps.store.appendMessage(sessionId, item.message)
      else this.deps.store.appendTool(sessionId, item.tool)
    }
    return true
  }

  renameSession(agentId: string, sessionId: string, title: string): SessionSummary | null {
    const session = this.deps.store.get(sessionId)
    if (!session || session.agentId !== agentId) return null
    this.deps.store.setTitle(sessionId, title)
    return this.summary(this.deps.store.get(sessionId)!)
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

  setVariant(agentId: string, variant: string | undefined): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const allowed = this.allowedVariantsFor(agent)
    const valid = variant && allowed.includes(variant) ? variant : undefined
    agent.variant = valid
    this.agents.set(agentId, agent)
    if (!this.running.has(agentId)) {
      this.runners.delete(agentId)
      this.resolved.delete(agentId)
      this.register(agent)
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

  getContextInfo(agentId: string): ContextInfo {
    const agent = this.agents.get(agentId)
    if (!agent) return { limit: null, compactThreshold: null, sessionCost: 0 }
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const limit = modelLimit?.context ?? cfg.maxContextTokens ?? null
    const compactThreshold = cfg.compaction.auto && limit ? limit - cfg.compaction.buffer : null
    return {
      limit,
      compactThreshold,
      sessionCost: this.deps.store.getUsage(this.activeSessionId(agentId)).cost
    }
  }

  getProviderModels(): ModelRef[] {
    const cfg = loadMeowConfig(this.deps.configPath)
    const refs: ModelRef[] = []
    for (const [provider, p] of Object.entries(cfg.provider)) {
      for (const model of p.models) refs.push({ provider, model })
    }
    return refs
  }

  async getAvailableVariants(agentId: string): Promise<string[]> {
    const agent = this.agents.get(agentId)
    if (!agent || !this.deps.catalog) return []
    return this.allowedVariantsFor(agent)
  }

  getVariant(agentId: string): string | undefined {
    return this.agents.get(agentId)?.variant
  }

  private allowedVariantsFor(agent: AgentConfig): string[] {
    if (!this.deps.catalog) return []
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    if (!resolved.provider || !resolved.model) return []
    return Object.keys(this.modelVariants.get(`${resolved.provider}/${resolved.model}`) ?? {})
  }

  async fetchProviderModels(providerId: string): Promise<string[]> {
    if (!this.deps.catalog) return []
    const providers = await this.deps.catalog.fetch()
    return providers[providerId]?.models ?? []
  }

  async listProviderCatalog(): Promise<CatalogProviderSummary[]> {
    if (!this.deps.catalog) return []
    return this.deps.catalog.list()
  }

  async connectProvider(providerId: string, apiKey: string, baseUrl?: string): Promise<MeowSettings> {
    const catalog = await this.deps.catalog?.fetch() ?? {}
    const models = catalog[providerId]?.models ?? []
    const settings = this.getSettings()
    const existing = settings.providers.find(p => p.id === providerId)
    const nextProviders = [
      ...settings.providers.filter(p => p.id !== providerId),
      { id: providerId, apiKey, baseUrl: baseUrl || catalog[providerId]?.api, models }
    ]
    const defaultProvider = settings.providers.some(p => p.id === settings.defaultProvider)
      ? settings.defaultProvider
      : providerId
    return this.saveSettings({ ...settings, providers: nextProviders, defaultProvider })
  }

  async disconnectProvider(providerId: string): Promise<MeowSettings> {
    const settings = this.getSettings()
    const nextProviders = settings.providers.filter(p => p.id !== providerId)
    const defaultProvider = nextProviders.some(p => p.id === settings.defaultProvider)
      ? settings.defaultProvider
      : (nextProviders[0]?.id ?? '')
    return this.saveSettings({ ...settings, providers: nextProviders, defaultProvider })
  }

  getSettings(): MeowSettings {
    return configToSettings(loadMeowConfig(this.deps.configPath))
  }

  getMcpStatus(): McpServerStatus[] {
    return this.mcp.status()
  }

  truncationCleanup(): void {
    this.deps.truncation.cleanup(7)
  }

  listCommands(projectPath: string): Command[] {
    const user = this.deps.commands?.list() ?? []
    return uniqueCommands(user, projectCommands(projectPath))
  }

  saveCommand(command: Command): Command {
    if (!this.deps.commands) throw new Error('commands store unavailable')
    return this.deps.commands.save(command)
  }

  removeCommand(name: string): void {
    if (!this.deps.commands) throw new Error('commands store unavailable')
    this.deps.commands.remove(name)
  }

  async runCommand(agentId: string, name: string, args: string[]): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const all = this.listCommands(agent.cwd)
    const command = all.find(c => c.name === name || `/${c.name}` === name)
    if (!command) {
      this.emit({ type: 'error', agentId, message: `[meow] Không tìm thấy command "${name}".` })
      return
    }
    const text = await resolveCommand(command, args, { cwd: agent.cwd, commands: all })
    await this.send(agentId, text)
  }

  getStats(): StatsSummary {
    const sessions = this.deps.store.listAll()
    const perModel: Record<string, ModelUsage> = {}
    let totalCost = 0
    let totalTokens = 0
    const perSession: Array<{ id: string; title: string; model: string; usage: UsageSummary }> = []
    for (const s of sessions) {
      const model = this.resolved.get(s.agentId)?.model ?? ''
      const u = s.usage
      totalCost += u.cost
      totalTokens += u.input + u.output
      perModel[model] = {
        messages: (perModel[model]?.messages ?? 0) + 1,
        tokens: (perModel[model]?.tokens ?? 0) + u.input + u.output,
        cost: (perModel[model]?.cost ?? 0) + u.cost
      }
      perSession.push({ id: s.id, title: s.title, model, usage: u })
    }
    return { totalCost, totalTokens, perModel, perSession }
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
    await this.refreshModelLimits()
    for (const agent of agents) this.register(agent)
  }

  async dispose(): Promise<void> {
    this.stopAll()
    await this.mcp.closeAll()
    this.deps.lsp?.dispose()
  }

  private async refreshModelLimits(): Promise<void> {
    if (!this.deps.catalog) return
    try {
      const providers = await this.deps.catalog.fetch()
      this.modelLimits.clear()
      this.modelVariants.clear()
      for (const [providerId, p] of Object.entries(providers)) {
        for (const model of p.models) {
          const limit = p.limits?.[model]
          if (limit && (limit.context !== undefined || limit.output !== undefined)) {
            this.modelLimits.set(`${providerId}/${model}`, limit)
          }
          const variants = p.variants?.[model]
          if (variants && Object.keys(variants).length > 0) {
            this.modelVariants.set(`${providerId}/${model}`, variants)
          }
        }
      }
    } catch {
      /* offline: fall back to config maxContextTokens */
    }
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
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const contextTokens = modelLimit?.context ?? cfg.maxContextTokens
    const skills = collectSkills(agent.cwd, this.deps.userSkillsDir, this.deps.builtinSkillsDir)
    const instructions = instructionsText(loadInstructions(agent.cwd, this.deps.userInstructionsDir))
    const llmClient = (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)
    const taskTool = createTaskTool({ llm: llmClient, model: resolved.model, tools: this.tools })
    const runnerTools = new Map<string, ToolDefinition>([...this.tools])
    runnerTools.set('task', taskTool)
    runnerTools.set('revert', revertTool)
    if (cfg.lsp.enabled && this.deps.lsp) runnerTools.set('lsp', createLspTool(this.deps.lsp))
    const mode = agent.mode ?? 'build'
    this.modes.set(agent.id, mode)
    const modeNote = mode === 'plan'
      ? '\n\nYou are in PLAN MODE: read-only analysis. Do NOT create, edit, or delete files. ' +
        'write/edit/apply-patch/revert/git/todowrite tools are unavailable, and do NOT use the bash tool ' +
        'to modify the filesystem either. Produce a plan or analysis instead.'
      : ''
    const allowed = this.allowedVariantsFor(agent)
    const validVariant =
      agent.variant && allowed.includes(agent.variant) ? agent.variant : undefined
    if (validVariant !== agent.variant) {
      agent.variant = validVariant
      this.agents.set(agent.id, agent)
    }
    const modelKey = `${resolved.provider}/${resolved.model}`
    const variantOptions = validVariant ? this.modelVariants.get(modelKey)?.[validVariant] : undefined
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
      maxSteps: cfg.maxSteps,
      maxContextTokens: contextTokens,
      compaction: cfg.compaction,
      toolOutput: cfg.toolOutput,
      truncation: this.deps.truncation,
      replaceItems: (items) => this.deps.store.replaceItems(this.activeSessionId(agent.id), items),
      snapshots: this.deps.snapshots,
      onEvent: (e) => this.emit(e),
      getItems: () => this.deps.store.get(this.activeSessionId(agent.id))?.items ?? [],
      appendMessage: (msg) => this.deps.store.appendMessage(this.activeSessionId(agent.id), msg),
      appendTool: (tool) => this.deps.store.appendTool(this.activeSessionId(agent.id), tool),
      setTodos: (todos) => {
        this.deps.store.setTodos(this.activeSessionId(agent.id), todos)
        this.emit({ type: 'todo-updated', agentId: agent.id, todos })
      },
      variantOptions,
      diagnostics: cfg.lsp.enabled && this.deps.lsp
        ? (filePath, text) => this.deps.lsp!.diagnosticsText(filePath, text)
        : undefined,
      computeCost: (tokens) => calcCost({ input: tokens.input, output: tokens.output }, this.priceFor(resolved.provider, resolved.model)),
      onUsage: (tokens) => {
        const price = this.priceFor(resolved.provider, resolved.model)
        const sessionId = this.activeSessionId(agent.id)
        const usage: UsageSummary = {
          input: tokens.input,
          output: tokens.output,
          cacheRead: 0,
          cacheWrite: 0,
          cost: calcCost({ input: tokens.input, output: tokens.output }, price)
        }
        this.deps.store.addUsage(sessionId, usage)
        this.emit({
          type: 'usage',
          agentId: agent.id,
          tokens,
          sessionCost: this.deps.store.getUsage(sessionId).cost
        })
      }
    })
    this.runners.set(agent.id, runner)
  }

  private priceFor(provider: string, model: string): ModelPrice | undefined {
    const p = this.deps.prices?.[`${provider}/${model}`]
    if (!p) return undefined
    return { input: p.input ?? 0, output: p.output ?? 0, cacheRead: p.cacheRead, cacheWrite: p.cacheWrite }
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
