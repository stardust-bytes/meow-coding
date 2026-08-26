import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { ChatEvent, ChatMessage, ChatTranscriptItem, ContextInfo, FileSuggestion, ImageAttachment, McpServerStatus, MeowSettings, MessageTokens, ModelUsage, NotificationsSettings, PromptResponse, QueuedMessage, StatsSummary, TodoItem, TraceEvent, UsageSummary } from '../shared/types'
import type { AgentConfig, AgentMode, ArtifactEntry, CatalogProviderSummary, Command, ModelRef, SubagentType } from '../shared/types'
import {
  configToSettings, loadMeowConfig, resolveAgentConfig, resolveApiKey, settingsToConfig, writeMeowConfig,
  resolveOutputTokens,
  OLLAMA_CLOUD_BASE_URL,
  type MeowConfig, type ResolvedAgentConfig
} from './agent/config'
import { SessionRunner } from './agent/loop'
import { usableContextTokens } from './agent/compact'
import { createLlm } from './agent/llm'
import type { LlmClient } from './agent/llm'
import { decidePermission } from './agent/permission'
import { SessionStore } from './agent/session'
import type { SessionSummary, StoredSession } from './agent/session'
import { McpManager } from './agent/mcp/manager'
import { collectSkills, skillListText } from './agent/skill'
import { loadUserTools } from './agent/plugin'
import { instructionsText, loadInstructions } from './agent/instructions'
import { referenceHints } from './agent/references'
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
import type { VariantBody, VariantDescriptor } from './model-variants'
import { revertTool } from './agent/tools/revert'
import { createTaskTool } from './agent/tools/task'
import type { ResolvedSubagentModel } from './agent/tools/task'
import type { AccountEndpointResolver } from './agent/config'
import type { ToolDefinition } from './agent/tools/types'
import type { NotificationService } from './notification-service'
import type { Vault } from './vault'
import { TraceStore } from './agent/trace-store'
import type { TraceEventInput } from './agent/trace-store'

export interface MeowAgentManagerDeps {
  configPath: string
  vault?: Vault
  store: SessionStore
  trace?: TraceStore
  onTrace?: (e: TraceEvent) => void
  tools: Map<string, ToolDefinition>
  createLlm?: (provider: string, apiKey: string, baseUrl?: string) => LlmClient
  env?: NodeJS.ProcessEnv
  userSkillsDir?: string
  userToolsDir?: string
  builtinSkillsDir?: string
  snapshots: SnapshotStore
  savedPermissions: SavedPermissions
  catalog?: ModelsCatalog
  connections?: AccountEndpointResolver & Partial<{
    getActiveCodexModels(): Promise<ModelRef[]>
    getCodexVariantOptions(accountId: string, model: string, selectedVariant: string | undefined): Promise<VariantDescriptor | undefined>
  }>
  truncation: TruncationStore
  commands?: CommandStore
  prices?: Record<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>
  projectPath?: string
  lsp?: LspManager
  notify?: NotificationService
  onActivateAgent?: (agentId: string) => void
  onBackgroundChange?: (agentId: string, background: boolean) => void
  onVariantInvalidated?: (agentId: string) => void
  onArtifact?: (entry: Omit<ArtifactEntry, 'id' | 'ts'>) => void
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
  // In-flight turn per agent. A turn aborted mid-tool is still winding down
  // after `running` is cleared (process-tree kill takes time, and its tool
  // result is appended to the transcript only when the kill settles), so the
  // next turn must wait for it — see runTurn.
  private turnPromises = new Map<string, Promise<void>>()
  private onEvent: (e: ChatEvent) => void = () => {}
  private turnCounters = new Map<string, number>()
  private toolStartTs = new Map<string, number>()
  private pendingMessages = new Map<string, { turn: number; text: string; reasoning: string; tokens?: MessageTokens }>()
  private traceEnabled = false
  private lastUsageByAgent = new Map<string, MessageTokens>()
  private compacting = new Set<string>()
  private lastCompactionAt = new Map<string, number>()
  private registrationVersion = new Map<string, number>()
  private idleCompactTimer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: MeowAgentManagerDeps) {
    this.tools = new Map(deps.tools)
    const cfg = loadMeowConfig(deps.configPath)
    this.deps = { ...deps, notifications: cfg.notifications }
    this.traceEnabled = cfg.trace?.enabled ?? false
    // Auto-compact when a session sits over its context limit while idle
    // (compaction otherwise only runs at the start of a turn step).
    this.idleCompactTimer = setInterval(() => void this.maybeCompactIdle(), 20_000)
    this.idleCompactTimer.unref?.()
  }

  setOnEvent(cb: (e: ChatEvent) => void): void {
    this.onEvent = (e) => {
      if (e.type === 'done' || e.type === 'error') this.running.delete(e.agentId)
      cb(e)
      if (this.traceEnabled) this.writeTrace(e)
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

  isTraceEnabled(): boolean {
    return this.traceEnabled
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
      if (agent.kind === 'native') await this.register(agent, true)
    }
  }

  addAgent(agent: AgentConfig): void {
    if (agent.kind === 'native') void this.register(agent)
  }

  listAgents(): AgentConfig[] {
    return [...this.agents.values()]
  }

  removeAgent(agentId: string): void {
    this.registrationVersion.set(agentId, (this.registrationVersion.get(agentId) ?? 0) + 1)
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
    if (next.length !== q.length) {
      if (next.length === 0) this.queues.delete(agentId)
      else this.queues.set(agentId, next)
      this.emitQueue(agentId)
    }
    // If the message was already injected into the running turn, drop it from
    // the transcript too so the bubble disappears everywhere.
    this.deps.store.removeMessage(this.activeSessionId(agentId), id)
    this.emit({ type: 'message-removed', agentId, messageId: id })
  }

  editQueued(agentId: string, id: string, text: string): void {
    const q = this.queues.get(agentId) ?? []
    const idx = q.findIndex(m => m.id === id)
    if (idx < 0 || !text.trim()) return
    q[idx] = { ...q[idx], text, displayText: undefined }
    this.queues.set(agentId, q)
    this.emitQueue(agentId)
  }

  private enqueueMessage(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): void {
    const q = this.queues.get(agentId) ?? []
    if (q.length >= this.MAX_QUEUE) {
      this.emit({ type: 'error', agentId, message: '[meow] Hàng đợi đã đầy (tối đa 5 tin). Hãy chờ turn hiện tại xong hoặc xóa tin đang chờ.' })
      return
    }
    q.push({ id: randomUUID(), text, images, displayText })
    this.queues.set(agentId, q)
    this.emitQueue(agentId)
  }

  async send(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) {
      this.enqueueMessage(agentId, text, images, displayText)
      return
    }
    await this.runTurn(agentId, text, images, displayText)
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
    await this.runTurn(agentId, next.text, next.images, next.displayText)
    await this.drainQueue(agentId)
  }

  private async runTurn(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    // A turn aborted mid-tool is still winding down after `running` was
    // cleared: killing the process tree takes time, and the tool's result is
    // appended to the transcript only when the kill settles. If this turn's
    // user message is appended first, the transcript gets an orphan tool item
    // and the LLM rejects the whole conversation (400 "tool message without a
    // preceding tool_calls"). Wait for the previous turn to finish before
    // starting this one.
    const prev = this.turnPromises.get(agentId)
    if (prev) {
      await prev
      // A concurrent send() grabbed the slot while we waited — queue instead
      // so the caller's drainQueue picks it up once the current turn ends.
      if (this.running.has(agentId)) {
        this.enqueueMessage(agentId, text, images, displayText)
        return
      }
    }
    const turn = this.runTurnInner(agentId, text, images, displayText)
    this.turnPromises.set(agentId, turn)
    try {
      await turn
    } finally {
      if (this.turnPromises.get(agentId) === turn) this.turnPromises.delete(agentId)
    }
  }

  private async runTurnInner(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: referenceHints(agent.cwd, text),
      displayText: displayText ?? text,
      images,
      createdAt: Date.now()
    }
    this.deps.store.appendMessage(this.activeSessionId(agentId), message)
    this.emit({ type: 'user-message', agentId, message })
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

    let runner = this.runners.get(agentId)
    if (!runner) {
      await this.register(agent)
      runner = this.runners.get(agentId)
    }
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
  async undo(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    this.stop(agentId)
    // Wait for the aborted turn to fully wind down (its tool results are
    // appended asynchronously) so truncation doesn't leave an orphan tool
    // item behind.
    const prev = this.turnPromises.get(agentId)
    if (prev) await prev
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
      // Rebuild even while a turn is running: the in-flight runner keeps its
      // own reference, but the next turn must see the new mode in its system
      // prompt instead of the one baked when the session's first turn ran.
      this.runners.delete(agentId)
      this.resolved.delete(agentId)
      void this.register(agent)
    }
  }

  setVariant(agentId: string, variant: string | undefined): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    const resolved = this.resolveAgentConfig(loadMeowConfig(this.deps.configPath), agent.name, agent.model, agent.accountId)
    agent.variant = resolved.provider === 'codex' && agent.accountId
      ? variant
      : variant && this.allowedVariantsFor(agent).includes(variant) ? variant : undefined
    this.agents.set(agentId, agent)
    this.runners.delete(agentId)
    this.resolved.delete(agentId)
    void this.register(agent)
  }

  setModel(agentId: string, model: ModelRef): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.model = `${model.provider}/${model.model}`
    agent.accountId = model.accountId
    this.agents.set(agentId, agent)
    this.runners.delete(agentId)
    this.resolved.delete(agentId)
    void this.register(agent)
  }

  getAgentModel(agentId: string): ModelRef | null {
    const agent = this.agents.get(agentId)
    if (!agent) return null
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = this.resolveAgentConfig(cfg, agent.name, agent.model, agent.accountId)
    if (!resolved.provider || !resolved.model) return null
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...(agent.accountId ? { accountId: agent.accountId } : {})
    }
  }

  getContextInfo(agentId: string): ContextInfo {
    const agent = this.agents.get(agentId)
    if (!agent) return { limit: null, compactThreshold: null, sessionCost: 0 }
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = this.resolveAgentConfig(cfg, agent.name, agent.model, agent.accountId)
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const limit = modelLimit?.context ?? cfg.maxContextTokens ?? null
    const outputTokens = resolveOutputTokens(modelLimit, limit, cfg.maxOutputTokens)
    const compactThreshold = cfg.compaction.auto && limit
      ? usableContextTokens(limit, cfg.compaction.buffer, outputTokens)
      : null
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
    if (!agent) return []
    const resolved = this.resolveAgentConfig(loadMeowConfig(this.deps.configPath), agent.name, agent.model, agent.accountId)
    if (resolved.provider === 'codex' && agent.accountId) {
      const models = await this.deps.connections?.getActiveCodexModels?.() ?? []
      const variants = models.find(model => model.provider === 'codex' && model.accountId === agent.accountId && model.model === resolved.model)?.variants ?? []
      return variants
    }
    return this.allowedVariantsFor(agent)
  }

  getVariant(agentId: string): string | undefined {
    return this.agents.get(agentId)?.variant
  }

  private allowedVariantsFor(agent: AgentConfig): string[] {
    if (!this.deps.catalog) return []
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = this.resolveAgentConfig(cfg, agent.name, agent.model, agent.accountId)
    if (!resolved.provider || !resolved.model) return []
    return Object.keys(this.modelVariants.get(`${resolved.provider}/${resolved.model}`) ?? {})
  }

  async fetchProviderModels(providerId: string): Promise<string[]> {
    if (!this.deps.catalog) return []
    const providers = await this.deps.catalog.fetch()
    if (providerId === 'ollama-cloud') {
      const p = this.getSettings().providers.find(x => x.id === providerId)
      const key = p ? resolveApiKey(p, this.deps.env, this.deps.vault ? ref => this.deps.vault!.getSecret(ref) : undefined) : null
      const base = p?.baseUrl || providers[providerId]?.api
      if (key && base) {
        const live = await this.deps.catalog.fetchLiveModels(base, key)
        if (live) return live
      }
    }
    return providers[providerId]?.models ?? []
  }

  async listProviderCatalog(): Promise<CatalogProviderSummary[]> {
    if (!this.deps.catalog) return []
    return this.deps.catalog.list()
  }

  async connectProvider(providerId: string, apiKey: string, baseUrl?: string): Promise<MeowSettings> {
    const catalog = await this.deps.catalog?.fetch() ?? {}
    const catalogModels = catalog[providerId]?.models ?? []
    const settings = this.getSettings()
    const existing = settings.providers.find(p => p.id === providerId)
    // API keys are sent as the Authorization header value, which the HTTP
    // stack converts to a Latin-1 byte string: a stray non-ASCII character
    // (e.g. Vietnamese text pasted by accident) blows up at request time with
    // a cryptic "Cannot convert argument to a ByteString" TypeError. Reject it
    // here so the user gets an actionable message instead.
    if (apiKey && !/^[\x21-\x7E]+$/.test(apiKey)) {
      throw new Error('[meow] API key không hợp lệ: key chỉ được chứa ký tự ASCII (a-z, A-Z, 0-9 và ký hiệu). Vui lòng dán lại key chính xác.')
    }
    // Empty apiKey on an existing provider keeps the stored secret, so edits
    // that only change baseUrl don't require re-entering the key.
    let keyRef = existing?.keyRef
    let plainKey = existing ? existing.apiKey : ''
    if (apiKey) {
      if (this.deps.vault?.isAvailable()) {
        keyRef = `provider:${providerId}`
        this.deps.vault.saveSecret(keyRef, apiKey)
        plainKey = ''
      } else {
        keyRef = undefined
        plainKey = apiKey
      }
    }
    // Providers absent from the catalog (manual ones, or providers renamed in
    // models.dev) keep the previously synced model list instead of wiping it.
    let base = baseUrl || catalog[providerId]?.api || existing?.baseUrl
    // ollama-cloud serves the OpenAI-compatible API under /v1; a baseUrl like
    // https://ollama.com/api (native REST root, from Ollama's docs) or
    // https://ollama.com 404s on /chat/completions, so normalize it.
    if (providerId === 'ollama-cloud' && base && /ollama\.com/.test(base) && !/\/v\d+\/?$/.test(base)) {
      base = catalog[providerId]?.api || OLLAMA_CLOUD_BASE_URL
    }
    let models = catalogModels.length > 0 ? catalogModels : (existing?.models ?? [])
    // Ollama Cloud's server-side model tags differ from the models.dev catalog
    // (bare tags 404 "model not found"); sync the account's actual list so
    // every listed model is usable. Fall back to the catalog when unreachable.
    if (providerId === 'ollama-cloud' && apiKey && base && this.deps.catalog) {
      const live = await this.deps.catalog.fetchLiveModels(base, apiKey)
      if (live) models = live
    }
    const nextProviders = [
      ...settings.providers.filter(p => p.id !== providerId),
      { id: providerId, apiKey: plainKey, keyRef, baseUrl: base, models }
    ]
    const defaultProvider = settings.providers.some(p => p.id === settings.defaultProvider)
      ? settings.defaultProvider
      : providerId
    return this.writeSettingsAndReload({ ...settings, providers: nextProviders, defaultProvider })
  }

  async disconnectProvider(providerId: string): Promise<MeowSettings> {
    const settings = this.getSettings()
    this.deps.vault?.deleteSecret(`provider:${providerId}`)
    const nextProviders = settings.providers.filter(p => p.id !== providerId)
    const defaultProvider = nextProviders.some(p => p.id === settings.defaultProvider)
      ? settings.defaultProvider
      : (nextProviders[0]?.id ?? '')
    return this.writeSettingsAndReload({ ...settings, providers: nextProviders, defaultProvider })
  }

  getSettings(): MeowSettings {
    return configToSettings(loadMeowConfig(this.deps.configPath))
  }

  getMcpStatus(): McpServerStatus[] {
    return this.mcp.status()
  }

  async reconnectMcp(): Promise<McpServerStatus[]> {
    await this.syncTools()
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
    // Keep the raw "/cmd …" input for the UI; the LLM receives the resolved prompt.
    const displayText = args.trim() ? `/${command.name} ${args.trim()}` : `/${command.name}`
    await this.send(agentId, text, undefined, displayText)
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
      // Provider dashboards count cache-read/write tokens in the input total,
      // so include them here to keep Meow's numbers comparable.
      totalTokens += u.input + u.output + u.cacheRead + u.cacheWrite
      perModel[model] = {
        messages: (perModel[model]?.messages ?? 0) + 1,
        tokens: (perModel[model]?.tokens ?? 0) + u.input + u.output + u.cacheRead + u.cacheWrite,
        cost: (perModel[model]?.cost ?? 0) + u.cost
      }
      perSession.push({ id: s.id, title: s.title, model, usage: u })
    }
    return { totalCost, totalTokens, perModel, perSession }
  }

  async saveSettings(settings: MeowSettings): Promise<MeowSettings> {
    this.writeSettings(settings)
    await this.reload()
    return configToSettings(settingsToConfig(settings, loadMeowConfig(this.deps.configPath)))
  }

  /**
   * Write settings to disk and kick off reload() in the background without
   * awaiting it. Used by provider connect/disconnect so the IPC call returns
   * immediately (closing the UI modal) instead of blocking on MCP server
   * reconnection inside reload(), which can take up to 60s per server.
   */
  private writeSettingsAndReload(settings: MeowSettings): MeowSettings {
    this.writeSettings(settings)
    void this.reload()
    return configToSettings(settingsToConfig(settings, loadMeowConfig(this.deps.configPath)))
  }

  private writeSettings(settings: MeowSettings): void {
    const current = loadMeowConfig(this.deps.configPath)
    const cfg = settingsToConfig(settings, current)
    writeMeowConfig(this.deps.configPath, cfg)
    this.deps = { ...this.deps, notifications: cfg.notifications }
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
    this.traceEnabled = loadMeowConfig(this.deps.configPath).trace?.enabled ?? false
    for (const agent of agents) await this.register(agent)
  }

  async dispose(): Promise<void> {
    if (this.idleCompactTimer) { clearInterval(this.idleCompactTimer); this.idleCompactTimer = null }
    this.stopAll()
    this.deps.store.flush()
    await this.mcp.closeAll()
    this.deps.lsp?.dispose()
  }

  // Runs compaction for agents sitting over the context limit while no turn
  // is in flight. Cheap threshold check first; only then spend an LLM call.
  private async maybeCompactIdle(): Promise<void> {
    const cfg = loadMeowConfig(this.deps.configPath)
    for (const agentId of this.runners.keys()) {
      if (this.running.has(agentId) || this.compacting.has(agentId)) continue
      const now = Date.now()
      const lastAttempt = this.lastCompactionAt.get(agentId) ?? 0
      if (now - lastAttempt < 60_000) continue
      const resolved = this.resolved.get(agentId)
      if (!resolved?.provider || !resolved.model) continue
      const modelLimit = this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      const limit = modelLimit?.context ?? cfg.maxContextTokens ?? null
      const compaction = cfg.compaction
      if (!compaction?.auto || !limit || limit <= 0) continue
      const used = this.lastUsageByAgent.get(agentId)
      if (!used) continue
      const usedTokens = used.total > 0
        ? used.total
        : used.input + used.output + (used.cacheRead ?? 0) + (used.cacheWrite ?? 0)
      const outputTokens = resolveOutputTokens(modelLimit, limit, cfg.maxOutputTokens)
      if (usedTokens < usableContextTokens(limit, compaction.buffer, outputTokens)) continue
      const runner = this.runners.get(agentId)
      if (!runner) continue
      this.compacting.add(agentId)
      this.lastCompactionAt.set(agentId, now)
      try {
        await runner.compactIfOverThreshold()
      } catch {
        /* compactIfOverThreshold never throws; safety net only */
      } finally {
        this.compacting.delete(agentId)
      }
    }
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

  private async register(agent: AgentConfig, force = false): Promise<void> {
    const registrationVersion = (this.registrationVersion.get(agent.id) ?? 0) + 1
    this.registrationVersion.set(agent.id, registrationVersion)
    this.agents.set(agent.id, agent)
    if (agent.background !== undefined) this.backgrounds.set(agent.id, agent.background)
    if (this.runners.has(agent.id)) {
      // Rebuild with freshly synced tools (MCP/user) unless a turn is running.
      if (!force || this.running.has(agent.id)) return
      this.runners.delete(agent.id)
      this.resolved.delete(agent.id)
    }
    const cfg = loadMeowConfig(this.deps.configPath)
    const resolved = this.resolveAgentConfig(cfg, agent.name, agent.model, agent.accountId)
    this.resolved.set(agent.id, resolved)
    const modelLimit = resolved.provider && resolved.model
      ? this.modelLimits.get(`${resolved.provider}/${resolved.model}`)
      : undefined
    const contextTokens = modelLimit?.context ?? cfg.maxContextTokens
    const outputTokens = resolveOutputTokens(modelLimit, contextTokens, cfg.maxOutputTokens)
    const skills = collectSkills(agent.cwd, this.deps.userSkillsDir, this.deps.builtinSkillsDir)
    // AGENTS.md/CLAUDE.md walking up from cwd are inlined into the system
    // prompt (opencode-style); module-level ones attach on read via loop.ts.
    const instructionFiles = loadInstructions(agent.cwd)
    const instructions = instructionsText(instructionFiles)
    const llmClient = (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)
    const resolveSubagent = (type: SubagentType): ResolvedSubagentModel | undefined => {
      const ref = cfg.subagentModels?.[type]
      if (!ref) return undefined
      const subResolved = this.resolveAgentConfig(cfg, agent.name, `${ref.provider}/${ref.model}`, ref.accountId)
      if (!subResolved.provider || !subResolved.model || !subResolved.apiKey) return undefined // fallback main
      const subLlm = (this.deps.createLlm ?? createLlm)(subResolved.provider, subResolved.apiKey, subResolved.baseUrl)
      return { provider: subResolved.provider, model: subResolved.model, llm: subLlm }
    }
    // Subagents spend real tokens, so their usage is billed to the session too,
    // but it must not overwrite lastUsageByAgent: that drives the parent's
    // context-overflow check and a subagent runs in a separate context.
    const reportUsage = (tokens: MessageTokens, isMainContext: boolean): void => {
      const price = this.priceFor(resolved.provider, resolved.model)
      const sessionId = this.activeSessionId(agent.id)
      const usage: UsageSummary = {
        input: tokens.input,
        output: tokens.output,
        cacheRead: tokens.cacheRead ?? 0,
        cacheWrite: tokens.cacheWrite ?? 0,
        cost: calcCost({
          input: tokens.input,
          output: tokens.output,
          cacheRead: tokens.cacheRead ?? 0,
          cacheWrite: tokens.cacheWrite ?? 0
        }, price)
      }
      if (isMainContext) this.lastUsageByAgent.set(agent.id, tokens)
      this.deps.store.addUsage(sessionId, usage)
      const sessionUsage = this.deps.store.getUsage(sessionId)
      this.emit({
        type: 'usage',
        agentId: agent.id,
        tokens,
        sessionCost: sessionUsage.cost,
        // "in" counts cached tokens too, matching provider dashboards (e.g.
        // DeepSeek's prompt_tokens = cache hit + miss).
        sessionTokens: { input: sessionUsage.input + sessionUsage.cacheRead + sessionUsage.cacheWrite, output: sessionUsage.output }
      })
    }

    const taskTool = createTaskTool({
      llm: llmClient,
      model: resolved.model,
      tools: this.tools,
      resolveSubagent,
      maxContextTokens: contextTokens,
      maxOutputTokens: outputTokens,
      compaction: cfg.compaction,
      toolOutput: cfg.toolOutput,
      truncation: this.deps.truncation,
      onUsage: (tokens) => reportUsage(tokens, false),
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
    const isCodex = resolved.provider === 'codex' && Boolean(agent.accountId)
    const modelKey = `${resolved.provider}/${resolved.model}`
    const variantOptions = isCodex
      ? await this.deps.connections?.getCodexVariantOptions?.(agent.accountId!, resolved.model, agent.variant)
      : agent.variant ? this.modelVariants.get(modelKey)?.[agent.variant] : undefined
    if (this.registrationVersion.get(agent.id) !== registrationVersion) return
    if (isCodex && agent.variant && !variantOptions) {
      agent.variant = undefined
      this.agents.set(agent.id, agent)
      this.deps.onVariantInvalidated?.(agent.id)
    }
    if (!isCodex && agent.variant && !variantOptions) {
      agent.variant = undefined
      this.agents.set(agent.id, agent)
    }
    const runner = new SessionRunner({
      agentId: agent.id,
      turn: this.turnCounters.get(this.activeSessionId(agent.id)) ?? 1,
      model: resolved.model,
      // Rebuilt per turn so a skill added or an AGENTS.md edited mid-session
      // takes effect without a reload. `instructions`/`skills` above are still
      // used for the registration-time systemInstructionPaths set.
      system: () => resolved.systemPrompt + modeNote +
        instructionsText(loadInstructions(agent.cwd)) +
        skillListText(collectSkills(agent.cwd, this.deps.userSkillsDir, this.deps.builtinSkillsDir)),
      systemInstructionPaths: new Set(instructionFiles.map(f => f.path)),
      cwd: agent.cwd,
      llm: llmClient,
      tools: runnerTools,
      decidePermission: (tool, input) => decidePermission(
        this.modes.get(agent.id) ?? 'build',
        cfg.permission,
        (t) => this.deps.savedPermissions.isAllowed(agent.cwd, t),
        tool,
        input
      ),
      ask: (promptId, tool) => this.awaitPrompt(agent.id, promptId, tool),
      maxSteps: cfg.maxSteps,
      maxContextTokens: contextTokens,
      maxOutputTokens: outputTokens,
      compaction: cfg.compaction,
      toolOutput: cfg.toolOutput,
      truncation: this.deps.truncation,
      replaceItems: (items) => this.deps.store.replaceItems(this.activeSessionId(agent.id), items),
      snapshots: this.deps.snapshots,
      onEvent: (e) => this.emit(e),
      onArtifact: (entry) => this.deps.onArtifact?.(entry),
      getItems: () => this.deps.store.get(this.activeSessionId(agent.id))?.items ?? [],
      appendMessage: (msg) => this.deps.store.appendMessage(this.activeSessionId(agent.id), msg),
      appendTool: (tool) => this.deps.store.appendTool(this.activeSessionId(agent.id), tool),
      takeSteers: () => {
        const q = this.queues.get(agent.id)
        if (!q || q.length === 0) return []
        this.queues.delete(agent.id)
        this.emitQueue(agent.id)
        return q
      },
      setTodos: (todos) => {
        this.deps.store.setTodos(this.activeSessionId(agent.id), todos)
        this.emit({ type: 'todo-updated', agentId: agent.id, todos })
      },
      variantOptions,
      diagnostics: cfg.lsp.enabled && this.deps.lsp
        ? (filePath, text) => this.deps.lsp!.diagnosticsText(filePath, text)
        : undefined,
      computeCost: (tokens) => calcCost({
        input: tokens.input,
        output: tokens.output,
        cacheRead: tokens.cacheRead ?? 0,
        cacheWrite: tokens.cacheWrite ?? 0
      }, this.priceFor(resolved.provider, resolved.model)),
      onUsage: (tokens) => reportUsage(tokens, true)
    })
    this.runners.set(agent.id, runner)
  }

  private resolveAgentConfig(cfg: MeowConfig, agentName: string, agentModel?: string, accountId?: string): ResolvedAgentConfig {
    return resolveAgentConfig(
      cfg,
      agentName,
      this.deps.env,
      agentModel,
      this.deps.vault ? (ref: string) => this.deps.vault!.getSecret(ref) : undefined,
      { accountId, resolveEndpoint: (id) => this.deps.connections?.getChatEndpoint(id) ?? null }
    )
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
    const emitTrace = (ev: TraceEventInput) => {
      const full = trace.append(sessionId, ev)
      this.deps.onTrace?.(full)
      return full
    }
    // text/reasoning deltas accumulate into one assistant message; flush it
    // at the next event boundary so the trace shows full content, not one
    // row per streamed delta (and far fewer writes -> less UI churn).
    const flushMessage = () => {
      const pending = this.pendingMessages.get(sessionId)
      if (!pending || (!pending.text && !pending.reasoning)) return
      emitTrace({
        type: 'message', agentId, sessionId, turn: pending.turn, role: 'assistant',
        text: pending.text || undefined,
        reasoning: pending.reasoning || undefined,
        tokens: pending.tokens
      })
      this.pendingMessages.delete(sessionId)
    }
    switch (e.type) {
      case 'turn-started':
        // counter already incremented before emit (see runTurn)
        this.pendingMessages.delete(sessionId)
        emitTrace({ type: 'turn-started', agentId, sessionId, turn: this.turnCounters.get(sessionId) ?? 1 })
        break
      case 'text-delta': {
        const pending = this.pendingMessages.get(sessionId) ?? { turn, text: '', reasoning: '' }
        pending.text += e.delta
        pending.turn = turn
        this.pendingMessages.set(sessionId, pending)
        break
      }
      case 'reasoning-delta': {
        const pending = this.pendingMessages.get(sessionId) ?? { turn, text: '', reasoning: '' }
        pending.reasoning += e.delta
        pending.turn = turn
        this.pendingMessages.set(sessionId, pending)
        break
      }
      case 'usage': {
        const pending = this.pendingMessages.get(sessionId)
        if (pending) pending.tokens = e.tokens
        break
      }
      case 'tool-start':
        flushMessage()
        this.toolStartTs.set(e.call.id, Date.now())
        emitTrace({ type: 'tool-start', agentId, sessionId, turn, callId: e.call.id, tool: e.call.tool, input: e.call.input })
        break
      case 'tool-result': {
        const startTs = this.toolStartTs.get(e.call.id)
        const durationMs = startTs !== undefined ? Date.now() - startTs : 0
        this.toolStartTs.delete(e.call.id)
        emitTrace({ type: 'tool-result', agentId, sessionId, turn, callId: e.call.id, tool: e.call.tool, output: e.call.output, error: e.call.error, durationMs, cost: undefined })
        break
      }
      case 'subagent-event':
        flushMessage()
        emitTrace({
          type: 'subagent', agentId, sessionId, turn, taskId: e.taskId, parentTaskId: e.parentTaskId,
          subagentType: e.subagentType,
          state: e.sub === 'done' ? (e.state ?? 'completed') : 'running',
          text: e.sub === 'delta' ? e.text : undefined,
          result: e.result, tools: []
        })
        break
      case 'compacted':
        flushMessage()
        emitTrace({ type: 'compaction', agentId, sessionId, turn, summary: e.summary })
        break
      case 'error':
        flushMessage()
        emitTrace({ type: 'error', agentId, sessionId, message: e.message })
        break
      case 'done':
        flushMessage()
        emitTrace({ type: 'done', agentId, sessionId, reason: e.reason, tokens: e.tokens, cost: e.cost })
        this.deps.trace?.flush(sessionId)
        break
      default:
        break
    }
  }

  private emit(e: ChatEvent): void {
    this.onEvent(e)
  }
}
