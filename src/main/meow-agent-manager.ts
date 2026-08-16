import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { ChatEvent, ChatMessage, ChatTranscriptItem, ContextInfo, FileSuggestion, ImageAttachment, McpServerStatus, MeowSettings, ModelUsage, NotificationsSettings, PromptResponse, QueuedMessage, StatsSummary, TodoItem, UsageSummary } from '../shared/types'
import type { AgentConfig, AgentMode, CatalogProviderSummary, Command, ModelRef } from '../shared/types'
import {
  configToSettings, loadMeowConfig, resolveAgentConfig, settingsToConfig, writeMeowConfig,
  type MeowConfig, type ResolvedAgentConfig
} from './agent/config'
import { SessionRunner } from './agent/loop'
import { createLlm } from './agent/llm'
import type { LlmClient } from './agent/llm'
import { CHATGPT_WEB_PROVIDER_ID, getChatGptWebModelRefs } from './chatgpt-web/model-catalog'
import type { ChatGptWebManager } from './chatgpt-web/manager'
import { decidePermission } from './agent/permission'
import { SessionStore } from './agent/session'
import type { SessionSummary, StoredSession } from './agent/session'
import { McpManager } from './agent/mcp/manager'
import { collectSkills, skillListText } from './agent/skill'
import { loadUserTools } from './agent/plugin'
import { instructionsText, loadInstructions } from './agent/instructions'
import { expandReferences } from './agent/references'
import { suggestFiles } from './file-suggest'
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
import type { NotificationService } from './notification-service'
import { TraceStore } from './agent/trace-store'

function defaultCreateChatGptWebLlmClient(manager: ChatGptWebManager): LlmClient {
  return manager.createLlmClient()
}

export interface MeowAgentManagerDeps {
  configPath: string
  store: SessionStore
  trace?: TraceStore
  tools: Map<string, ToolDefinition>
  createLlm?: (provider: string, apiKey: string, baseUrl?: string) => LlmClient
  chatGptWeb?: ChatGptWebManager
  createChatGptWebLlmClient?: (manager: ChatGptWebManager) => LlmClient
  env?: NodeJS.ProcessEnv
  userSkillsDir?: string
  userToolsDir?: string
  builtinSkillsDir?: string
  snapshots: SnapshotStore
  savedPermissions: SavedPermissions
  catalog?: ModelsCatalog
  truncation: TruncationStore
  commands?: CommandStore
  prices?: Record<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>
  projectPath?: string
  lsp?: LspManager
  notify?: NotificationService
  onActivateAgent?: (agentId: string) => void
  onBackgroundChange?: (agentId: string, background: boolean) => void
  notifications?: NotificationsSettings
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
  private backgrounds = new Map<string, boolean>()
  private queues = new Map<string, QueuedMessage[]>()
  private onEvent: (e: ChatEvent) => void = () => {}
  private turnCounters = new Map<string, number>()
  private toolStartTs = new Map<string, number>()

  constructor(private deps: MeowAgentManagerDeps) {
    this.tools = new Map(deps.tools)
    this.deps = { ...deps, notifications: loadMeowConfig(deps.configPath).notifications }
  }

  setOnEvent(cb: (e: ChatEvent) => void): void {
    this.onEvent = (e) => {
      if (e.type === 'done' || e.type === 'error') this.running.delete(e.agentId)
      cb(e)
      this.writeTrace(e)
      if (e.type === 'done' && this.deps.notifications?.onDone !== false) {
        const cost = e.cost !== undefined ? ` · ${e.cost.toFixed(4)}` : ''
        this.deps.notify?.notify({
          title: '[meow] Hoàn thành',
          body: `${this.agents.get(e.agentId)?.name ?? e.agentId}${e.reason ? ` (${e.reason})` : ''}${cost}`,
          agentId: e.agentId,
          onActivate: () => this.deps.onActivateAgent?.(e.agentId)
        })
      } else if (e.type === 'error' && this.deps.notifications?.onDone !== false) {
        this.deps.notify?.notify({
          title: '[meow] Lỗi',
          body: `${this.agents.get(e.agentId)?.name ?? e.agentId}: ${e.message}`,
          agentId: e.agentId,
          onActivate: () => this.deps.onActivateAgent?.(e.agentId)
        })
      }
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

  isBackground(agentId: string): boolean {
    return this.backgrounds.get(agentId) ?? false
  }

  async suggestFiles(agentId: string, prefix: string): Promise<FileSuggestion[]> {
    const agent = this.agents.get(agentId)
    if (!agent) return []
    return suggestFiles(agent.cwd, prefix)
  }

  setBackground(agentId: string, background: boolean): void {
    this.backgrounds.set(agentId, background)
    this.deps.onBackgroundChange?.(agentId, background)
  }

  async init(agents: AgentConfig[]): Promise<void> {
    await this.syncTools()
    await this.refreshModelLimits()
    for (const agent of agents) {
      if (agent.kind === 'native') this.register(agent, true)
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
    this.backgrounds.delete(agentId)
    this.queues.delete(agentId)
    this.deps.snapshots.clear(agentId)
    // Capture session ids before deleteForAgent purges them from the store.
    const sessionIds = this.deps.store.list(agentId).map(s => s.id)
    this.deps.store.deleteForAgent(agentId)
    for (const id of sessionIds) this.deps.trace?.delete(id)
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
    this.deps.trace?.delete(sessionId)
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

  private MAX_QUEUE = 5

  emitQueue(agentId: string): void {
    this.emit({ type: 'queue-updated', agentId, queue: this.queues.get(agentId) ?? [] })
  }

  listQueued(agentId: string): QueuedMessage[] {
    return this.queues.get(agentId) ?? []
  }

  removeQueued(agentId: string, id: string): void {
    const q = this.queues.get(agentId) ?? []
    const next = q.filter(m => m.id !== id)
    if (next.length === q.length) return
    if (next.length === 0) this.queues.delete(agentId)
    else this.queues.set(agentId, next)
    this.emitQueue(agentId)
  }

  editQueued(agentId: string, id: string, text: string): void {
    const q = this.queues.get(agentId) ?? []
    const idx = q.findIndex(m => m.id === id)
    if (idx < 0 || !text.trim()) return
    q[idx] = { ...q[idx], text }
    this.queues.set(agentId, q)
    this.emitQueue(agentId)
  }

  async send(agentId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) {
      const q = this.queues.get(agentId) ?? []
      if (q.length >= this.MAX_QUEUE) {
        this.emit({ type: 'error', agentId, message: '[meow] Hàng đợi đã đầy (tối đa 5 tin). Hãy chờ turn hiện tại xong hoặc xóa tin đang chờ.' })
        return
      }
      q.push({ id: randomUUID(), text, images })
      this.queues.set(agentId, q)
      this.emitQueue(agentId)
      return
    }
    await this.runTurn(agentId, text, images)
    await this.drainQueue(agentId)
  }

  private async drainQueue(agentId: string): Promise<void> {
    if (this.running.has(agentId)) return
    const q = this.queues.get(agentId)
    if (!q || q.length === 0) return
    const next = q.shift()!
    if (q.length === 0) this.queues.delete(agentId)
    else this.queues.set(agentId, q)
    this.emitQueue(agentId)
    await this.runTurn(agentId, next.text, next.images)
    await this.drainQueue(agentId)
  }

  private async runTurn(agentId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
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
    this.nextTurn(agentId)
    this.emit({ type: 'turn-started', agentId })
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

  // User-facing stop: aborts the active turn, keeps the queue, and immediately
  // starts the next queued message (if any).
  async stopAndDrain(agentId: string): Promise<void> {
    this.stop(agentId)
    await this.drainQueue(agentId)
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
    const cfg = this.loadConfigWithChatGptWebSeed()
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    if (!resolved.provider || !resolved.model) return null
    return { provider: resolved.provider, model: resolved.model }
  }

  getContextInfo(agentId: string): ContextInfo {
    const agent = this.agents.get(agentId)
    if (!agent) return { limit: null, compactThreshold: null, sessionCost: 0 }
    const cfg = this.loadConfigWithChatGptWebSeed()
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
    refs.push(...(this.deps.chatGptWeb?.getModelRefsIfActive() ?? []))
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
    const cfg = this.loadConfigWithChatGptWebSeed()
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

  async runCommand(agentId: string, name: string, args: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const all = this.listCommands(agent.cwd)
    const command = all.find(c => c.name === name || `/${c.name}` === name)
    if (!command) {
      this.emit({ type: 'error', agentId, message: `[meow] Không tìm thấy command "${name}".` })
      return
    }
    // System commands act on state (e.g. creating a session) instead of
    // dispatching a prompt to the LLM.
    if (command.type === 'system') {
      if (command.name === 'new') {
        this.newSession(agentId)
        this.emit({ type: 'session-created', agentId })
      }
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
    this.deps = { ...this.deps, notifications: cfg.notifications }
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
    await this.mcp.connect(cfg.mcp ?? {}, this.deps.projectPath)
    const userTools = await loadUserTools(
      [this.deps.userToolsDir].filter((d): d is string => Boolean(d))
    )
    this.tools = new Map([
      ...this.deps.tools,
      ...userTools.map(t => [t.name, t] as const),
      ...this.mcp.getTools()
    ])
  }

  private register(agent: AgentConfig, force = false): void {
    this.agents.set(agent.id, agent)
    if (agent.background !== undefined) this.backgrounds.set(agent.id, agent.background)
    if (this.runners.has(agent.id)) {
      // Rebuild with freshly synced tools (MCP/user) unless a turn is running.
      if (!force || this.running.has(agent.id)) return
      this.runners.delete(agent.id)
      this.resolved.delete(agent.id)
    }
    const cfg = this.loadConfigWithChatGptWebSeed()
    const resolved = resolveAgentConfig(cfg, agent.name, this.deps.env, agent.model)
    this.resolved.set(agent.id, resolved)
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const contextTokens = modelLimit?.context ?? cfg.maxContextTokens
    const skills = collectSkills(agent.cwd, this.deps.userSkillsDir, this.deps.builtinSkillsDir)
    // AGENTS.md/CLAUDE.md walking up from cwd are inlined into the system
    // prompt (opencode-style); module-level ones attach on read via loop.ts.
    const instructionFiles = loadInstructions(agent.cwd)
    const instructions = instructionsText(instructionFiles)
    const llmClient = resolved.provider === CHATGPT_WEB_PROVIDER_ID
      ? (this.deps.createChatGptWebLlmClient ?? defaultCreateChatGptWebLlmClient)(this.deps.chatGptWeb as ChatGptWebManager)
      : (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)
    const taskTool = createTaskTool({
      llm: llmClient,
      model: resolved.model,
      tools: this.tools,
      onBackgroundResult: (taskId, text, error) => {
        const sessionId = this.activeSessionId(agent.id)
        this.deps.store.appendMessage(sessionId, {
          id: randomUUID(),
          role: 'assistant',
          text: error
            ? `[subagent ${taskId} failed]\n${error}`
            : `[subagent ${taskId} result]\n${text}`,
          createdAt: Date.now()
        })
        this.emit({
          type: 'subagent-event',
          agentId: agent.id,
          taskId,
          sub: 'done',
          state: error ? 'error' : 'completed',
          result: error ? undefined : text
        })
      }
    })
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
      turn: this.turnCounters.get(this.activeSessionId(agent.id)) ?? 1,
      model: resolved.model,
      system: resolved.systemPrompt + modeNote + instructions + skillListText(skills),
      systemInstructionPaths: new Set(instructionFiles.map(f => f.path)),
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
        const sessionUsage = this.deps.store.getUsage(sessionId)
        this.emit({
          type: 'usage',
          agentId: agent.id,
          tokens,
          sessionCost: sessionUsage.cost,
          sessionTokens: { input: sessionUsage.input, output: sessionUsage.output }
        })
      }
    })
    this.runners.set(agent.id, runner)
  }

  // The chatgpt-web "provider" is a browser-driven session, not an API-key
  // entry a user configures in meow.json. Seed a synthetic provider entry so
  // resolveAgentConfig's generic provider/model lookup resolves it like any
  // other provider, without requiring changes to agent/config.ts. Use this
  // wherever loadMeowConfig feeds into resolveAgentConfig.
  private loadConfigWithChatGptWebSeed(): MeowConfig {
    const cfg = loadMeowConfig(this.deps.configPath)
    if (this.deps.chatGptWeb && !cfg.provider[CHATGPT_WEB_PROVIDER_ID]) {
      cfg.provider[CHATGPT_WEB_PROVIDER_ID] = {
        apiKey: CHATGPT_WEB_PROVIDER_ID,
        models: getChatGptWebModelRefs().map(r => r.model)
      }
    }
    return cfg
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
      if (this.deps.notifications?.needsInput !== false) {
        this.deps.notify?.notify({
          title: '[meow] Cần bạn nhập',
          body: `${this.agents.get(agentId)?.name ?? agentId} đang chờ...`,
          agentId,
          onActivate: () => this.deps.onActivateAgent?.(agentId)
        })
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

  private nextTurn(agentId: string): number {
    const sessionId = this.activeSessionId(agentId)
    const next = (this.turnCounters.get(sessionId) ?? 0) + 1
    this.turnCounters.set(sessionId, next)
    return next
  }

  private writeTrace(e: ChatEvent): void {
    const trace = this.deps.trace
    if (!trace) return
    const agentId = e.agentId
    const sessionId = this.activeSessionId(agentId)
    const turn = this.turnCounters.get(sessionId) ?? 0
    switch (e.type) {
      case 'turn-started':
        // counter already incremented before emit (see runTurn)
        trace.append(sessionId, { type: 'turn-started', agentId, sessionId, turn: this.turnCounters.get(sessionId) ?? 1 })
        break
      case 'text-delta':
        trace.append(sessionId, { type: 'message', agentId, sessionId, turn, role: 'assistant', text: e.delta })
        break
      case 'reasoning-delta':
        trace.append(sessionId, { type: 'message', agentId, sessionId, turn, role: 'assistant', reasoning: e.delta })
        break
      case 'tool-start':
        this.toolStartTs.set(e.call.id, Date.now())
        trace.append(sessionId, { type: 'tool-start', agentId, sessionId, turn, callId: e.call.id, tool: e.call.tool, input: e.call.input })
        break
      case 'tool-result': {
        const startTs = this.toolStartTs.get(e.call.id)
        const durationMs = startTs !== undefined ? Date.now() - startTs : 0
        this.toolStartTs.delete(e.call.id)
        trace.append(sessionId, { type: 'tool-result', agentId, sessionId, turn, callId: e.call.id, tool: e.call.tool, output: e.call.output, error: e.call.error, durationMs, cost: undefined })
        break
      }
      case 'subagent-event':
        trace.append(sessionId, {
          type: 'subagent', agentId, sessionId, turn, taskId: e.taskId, parentTaskId: e.parentTaskId,
          subagentType: e.subagentType,
          state: e.sub === 'done' ? (e.state ?? 'completed') : 'running',
          text: e.sub === 'delta' ? e.text : undefined,
          result: e.result, tools: []
        })
        break
      case 'compacted':
        trace.append(sessionId, { type: 'compaction', agentId, sessionId, turn, summary: e.summary })
        break
      case 'error':
        trace.append(sessionId, { type: 'error', agentId, sessionId, message: e.message })
        break
      case 'done':
        trace.append(sessionId, { type: 'done', agentId, sessionId, reason: e.reason, tokens: e.tokens, cost: e.cost })
        break
      default:
        break
    }
  }

  private emit(e: ChatEvent): void {
    this.onEvent(e)
  }
}
