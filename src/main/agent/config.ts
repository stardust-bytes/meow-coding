import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentSettings, CompactionSettings, MeowSettings, ModelRef, NotificationsSettings, PermissionRule, SubagentType } from '../../shared/types'
import type { McpServerConfig } from './mcp/manager'

export type { PermissionRule }
export type { McpServerConfig }

export interface MeowProviderConfig {
  apiKeyEnv?: string
  apiKey?: string
  /** Reference into the encrypted vault (safeStorage) — preferred over apiKey. */
  keyRef?: string
  baseUrl?: string
  models: string[]
}

export interface MeowAgentConfig {
  provider?: string
  model?: string
  accountId?: string
  systemPrompt: string
}

export type MeowCompactionConfig = CompactionSettings

export interface ToolOutputConfig {
  maxBytes: number
  maxLines: number
}

export interface LspConfig {
  enabled: boolean
  diagnosticsTimeoutMs: number
}

export type NotificationsConfig = NotificationsSettings

export interface TraceConfig {
  enabled: boolean
}

export interface MeowConfig {
  provider: Record<string, MeowProviderConfig>
  model: string
  agents: Record<string, MeowAgentConfig>
  permission: Record<string, PermissionRule>
  mcp: Record<string, McpServerConfig>
  maxContextTokens: number
  maxOutputTokens: number
  maxSteps: number
  compaction: MeowCompactionConfig
  toolOutput: ToolOutputConfig
  lsp: LspConfig
  notifications?: NotificationsConfig
  trace?: TraceConfig
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
}

export interface ResolvedAgentConfig {
  provider: string
  model: string
  apiKey: string | null
  baseUrl?: string
  systemPrompt: string
}

export interface AccountEndpointResolver {
  getChatEndpoint(accountId: string): { baseUrl: string; apiKey: string } | null
}

// Fallback only when the model is absent from the models.dev catalog; most
// uncatalogued OpenAI-compatible models cap at 128k, so assuming 200k would
// delay compaction past the real limit.
export const DEFAULT_MAX_CONTEXT_TOKENS = 128000
// A finite cap so a model stuck in a tool-call loop wraps up instead of
// burning tokens forever. The budget resets whenever steered messages are
// promoted, so this bounds one uninterrupted run, not a whole session.
export const DEFAULT_MAX_STEPS = 100
// Reserved from the context budget and sent as the provider's output cap.
// Fallback for models whose limit is unknown from the catalog: kept well
// under the 64k some models allow, a coding answer never needs that much.
export const DEFAULT_MAX_OUTPUT_TOKENS = 32000
// Ceiling on the per-answer output budget even when the catalog claims more
// (e.g. deepseek-v4-flash:0731 lists 1M output): reserving that much from the
// context budget would push the auto-compact threshold to zero.
export const MAX_OUTPUT_HARD_CAP = 131072

/**
 * Effective per-answer output budget. A model with a catalog limit uses it
 * (capped so a huge claim can't starve the context budget); unknown models
 * fall back to the user setting. Never reserves more than half the context
 * window so compaction always keeps room to work.
 */
export function resolveOutputTokens(
  modelLimit: { output?: number } | undefined,
  contextLimit: number | null | undefined,
  fallback: number
): number {
  const base = modelLimit?.output ?? fallback
  if (!contextLimit || contextLimit <= 0) return Math.min(base, MAX_OUTPUT_HARD_CAP)
  return Math.min(base, MAX_OUTPUT_HARD_CAP, Math.floor(contextLimit / 2))
}
export const DEFAULT_COMPACTION: MeowCompactionConfig = {
  auto: true,
  buffer: 20000,
  keepTokens: 8000,
  tailTurns: 2,
  toolOutputMaxChars: 2000,
  prune: true
}
export const DEFAULT_TOOL_OUTPUT: ToolOutputConfig = {
  maxBytes: 51200,
  maxLines: 2000
}
export const DEFAULT_LSP: LspConfig = {
  enabled: true,
  diagnosticsTimeoutMs: 3000
}
export const DEFAULT_TRACE: TraceConfig = {
  enabled: false
}
export const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
  needsInput: true,
  onDone: true
}

export const DEFAULT_MEOW_CONFIG: MeowConfig = {
  provider: {},
  model: '',
  agents: {
    meow: {
      systemPrompt: 'You are Meow, a coding agent running inside the Meow Coding desktop app. ' +
        'You help the user build and maintain their codebase. You have access to tools like ' +
        'bash, read, write, edit, glob, grep, apply-patch and todowrite. Read files before ' +
        'editing them, run tests after changes, and keep answers concise. Whenever you need ' +
        'input or a decision from the user, use the question tool to show an interactive form ' +
        'instead of writing questions as plain text.'
    }
  },
  permission: {
    read: 'allow',
    write: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    'apply-patch': 'allow',
    todowrite: 'allow',
    task: 'allow',
    revert: 'allow',
    skill: 'allow',
    bash: 'ask',
    office: 'ask',
    question: 'allow',
    'browser_*': 'allow'
  },
  mcp: {},
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxSteps: DEFAULT_MAX_STEPS,
  compaction: DEFAULT_COMPACTION,
  toolOutput: DEFAULT_TOOL_OUTPUT,
  lsp: DEFAULT_LSP,
  notifications: DEFAULT_NOTIFICATIONS,
  trace: DEFAULT_TRACE
}

type RawProvider = Partial<MeowProviderConfig> & Record<string, unknown>

/**
 * ollama-cloud serves the OpenAI-compatible API under /v1. Ollama's docs list
 * https://ollama.com/api as the cloud base URL, but that is the native REST API
 * (/api/chat, /api/generate) which has no /chat/completions endpoint — requests
 * to /api/chat/completions 404. Meow connects via the OpenAI-compatible SDK, so
 * the base URL is normalized to /v1.
 */
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com/v1'

function normalizeProvider(raw: RawProvider): MeowProviderConfig {
  const models = Array.isArray(raw.models)
    ? (raw.models as string[]).filter(m => typeof m === 'string' && m.trim() !== '')
    : typeof raw.model === 'string' && raw.model
      ? [raw.model]
      : []
  return {
    apiKeyEnv: raw.apiKeyEnv,
    apiKey: raw.apiKey,
    keyRef: raw.keyRef,
    baseUrl: raw.baseUrl,
    models
  }
}

function normalizeAgents(raw: Record<string, unknown> | undefined): Record<string, MeowAgentConfig> {
  const base = DEFAULT_MEOW_CONFIG.agents
  if (!raw) return { ...base }
  const out: Record<string, MeowAgentConfig> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Partial<MeowAgentConfig> & Record<string, unknown>
    const legacyModel = typeof v.model === 'string' ? v.model : undefined
    const isProviderRef = legacyModel !== undefined && !legacyModel.includes('/')
    out[name] = {
      provider: typeof v.provider === 'string' ? v.provider : (isProviderRef ? legacyModel : undefined),
      model: typeof v.model === 'string' && !isProviderRef ? v.model : undefined,
      accountId: typeof v.accountId === 'string' ? v.accountId : undefined,
      systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : (base[name]?.systemPrompt ?? base.meow.systemPrompt)
    }
  }
  return { ...base, ...out }
}

function normalizeCompaction(raw: Partial<MeowCompactionConfig> | undefined): MeowCompactionConfig {
  return {
    auto: raw?.auto ?? DEFAULT_COMPACTION.auto,
    buffer: raw?.buffer ?? DEFAULT_COMPACTION.buffer,
    keepTokens: raw?.keepTokens ?? DEFAULT_COMPACTION.keepTokens,
    tailTurns: raw?.tailTurns ?? DEFAULT_COMPACTION.tailTurns,
    toolOutputMaxChars: raw?.toolOutputMaxChars ?? DEFAULT_COMPACTION.toolOutputMaxChars,
    prune: raw?.prune ?? DEFAULT_COMPACTION.prune
  }
}

function normalizeToolOutput(raw: Partial<ToolOutputConfig> | undefined): ToolOutputConfig {
  return {
    maxBytes: raw?.maxBytes ?? DEFAULT_TOOL_OUTPUT.maxBytes,
    maxLines: raw?.maxLines ?? DEFAULT_TOOL_OUTPUT.maxLines
  }
}

function normalizeTrace(raw: Partial<TraceConfig> | undefined): TraceConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_TRACE.enabled
  }
}

function normalizeLsp(raw: Partial<LspConfig> | undefined): LspConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_LSP.enabled,
    diagnosticsTimeoutMs: raw?.diagnosticsTimeoutMs ?? DEFAULT_LSP.diagnosticsTimeoutMs
  }
}

function normalizeNotifications(raw: Partial<NotificationsConfig> | undefined): NotificationsConfig {
  return {
    needsInput: raw?.needsInput ?? DEFAULT_NOTIFICATIONS.needsInput,
    onDone: raw?.onDone ?? DEFAULT_NOTIFICATIONS.onDone
  }
}

function normalizeMcp(raw: Record<string, McpServerConfig> | undefined): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {}
  for (const [name, cfg] of Object.entries(raw ?? {})) {
    const next: McpServerConfig = { ...cfg }
    if (next.command) {
      const parts = next.command.trim().split(/\s+/).filter(Boolean)
      if (parts.length > 1 && (!next.args || next.args.length === 0)) {
        next.command = parts[0]
        next.args = parts.slice(1)
      }
    }
    out[name] = next
  }
  return out
}

function normalizeSubagentModels(
  raw: Partial<Record<SubagentType, ModelRef>> | undefined,
  providers: Record<string, MeowProviderConfig>
): Partial<Record<SubagentType, ModelRef>> | undefined {
  if (!raw) return undefined
  const out: Partial<Record<SubagentType, ModelRef>> = {}
  for (const [type, ref] of Object.entries(raw)) {
    if (!ref || !ref.provider || !ref.model) continue
    // Account-scoped providers resolve through the connection subsystem and do
    // not require a meow.json provider entry.
    if (!ref.accountId) {
      const provider = providers[ref.provider]
      if (!provider || !provider.models.includes(ref.model)) continue
    }
    out[type] = {
      provider: ref.provider,
      model: ref.model,
      ...(ref.accountId ? { accountId: ref.accountId } : {})
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function mergeDefaults(raw: Partial<MeowConfig>): MeowConfig {
  const providers: Record<string, MeowProviderConfig> = {}
  for (const [id, p] of Object.entries(raw.provider ?? {})) {
    const normalized = normalizeProvider(p as RawProvider)
    // Normalize on read so hand-edited meow.json (or a baseUrl saved before
    // this rule existed) can't 404 on /api/chat/completions. Self-hosted
    // Ollama under a different host is preserved.
    if (id === 'ollama-cloud' && (!normalized.baseUrl || /ollama\.com/.test(normalized.baseUrl))) {
      normalized.baseUrl = OLLAMA_CLOUD_BASE_URL
    }
    providers[id] = normalized
  }
  return {
    provider: providers,
    model: raw.model ?? DEFAULT_MEOW_CONFIG.model,
    agents: normalizeAgents(raw.agents),
    permission: { ...DEFAULT_MEOW_CONFIG.permission, ...(raw.permission ?? {}) },
    mcp: normalizeMcp(raw.mcp),
    maxContextTokens: raw.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    maxOutputTokens: raw.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxSteps: raw.maxSteps ?? DEFAULT_MAX_STEPS,
    compaction: normalizeCompaction(raw.compaction),
    toolOutput: normalizeToolOutput(raw.toolOutput),
    lsp: normalizeLsp(raw.lsp),
    notifications: normalizeNotifications(raw.notifications),
    trace: normalizeTrace(raw.trace),
    subagentModels: normalizeSubagentModels(raw.subagentModels, providers)
  }
}

export function loadMeowConfig(filePath: string): MeowConfig {
  if (!existsSync(filePath)) return mergeDefaults({})
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) return mergeDefaults({})
    return mergeDefaults(parsed as Partial<MeowConfig>)
  } catch {
    return mergeDefaults({})
  }
}

export function resolveApiKey(
  provider: MeowProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  getSecret?: (ref: string) => string | null
): string | null {
  if (provider.apiKey) return provider.apiKey
  if (provider.keyRef && getSecret) {
    const secret = getSecret(provider.keyRef)
    if (secret) return secret
  }
  if (provider.apiKeyEnv) return env[provider.apiKeyEnv] ?? null
  return null
}

export function resolveAgentConfig(
  cfg: MeowConfig,
  agentName: string,
  env: NodeJS.ProcessEnv = process.env,
  agentModel?: string,
  getSecret?: (ref: string) => string | null,
  opts?: { accountId?: string; resolveEndpoint?: AccountEndpointResolver['getChatEndpoint'] }
): ResolvedAgentConfig {
  const agent = cfg.agents[agentName] ?? cfg.agents.meow
  let providerName = agent.provider ?? cfg.model
  let modelName: string | undefined
  if (agentModel) {
    const slash = agentModel.indexOf('/')
    if (slash > 0) {
      providerName = agentModel.slice(0, slash)
      modelName = agentModel.slice(slash + 1)
    } else {
      providerName = agentModel
    }
  } else if (agent.model) {
    const slash = agent.model.indexOf('/')
    if (slash > 0) {
      providerName = agent.model.slice(0, slash)
      modelName = agent.model.slice(slash + 1)
    } else {
      providerName = agent.model
    }
  }
  // Account-scoped providers (Codex OAuth) route through the connection
  // subsystem: the api key is the local proxy credential, the base URL is the
  // account-scoped loopback proxy. This branch runs before the meow.json
  // provider lookup so a connected account works even when no `codex` provider
  // entry exists in the config.
  if (providerName === 'codex' && opts?.accountId) {
    const endpoint = opts.resolveEndpoint?.(opts.accountId) ?? null
    if (endpoint) {
      return { provider: providerName, model: modelName ?? '', apiKey: endpoint.apiKey, baseUrl: endpoint.baseUrl, systemPrompt: agent.systemPrompt }
    }
    return { provider: providerName, model: modelName ?? '', apiKey: null, systemPrompt: agent.systemPrompt }
  }
  const provider = cfg.provider[providerName]
  if (!provider) {
    return { provider: '', model: '', apiKey: null, systemPrompt: agent.systemPrompt }
  }
  const model = modelName && provider.models.includes(modelName) ? modelName : (provider.models[0] ?? '')
  return {
    provider: providerName,
    model,
    apiKey: resolveApiKey(provider, env, getSecret),
    baseUrl: provider.baseUrl,
    systemPrompt: agent.systemPrompt
  }
}

export function configToSettings(cfg: MeowConfig): MeowSettings {
  return {
    providers: Object.entries(cfg.provider).map(([id, p]) => ({
      id,
      apiKey: p.apiKey ?? '',
      keyRef: p.keyRef,
      baseUrl: p.baseUrl,
      models: p.models
    })),
    defaultProvider: cfg.model,
    agents: Object.entries(cfg.agents).map(([name, a]) => ({
      name,
      systemPrompt: a.systemPrompt,
      provider: a.provider,
      model: a.model,
      ...(a.accountId ? { accountId: a.accountId } : {})
    })),
    permission: cfg.permission,
    mcp: cfg.mcp,
    maxContextTokens: cfg.maxContextTokens,
    maxOutputTokens: cfg.maxOutputTokens,
    maxSteps: cfg.maxSteps,
    compaction: cfg.compaction,
    toolOutput: cfg.toolOutput,
    lsp: cfg.lsp,
    notifications: cfg.notifications ? normalizeNotifications(cfg.notifications) : DEFAULT_NOTIFICATIONS,
    trace: normalizeTrace(cfg.trace),
    ...(cfg.subagentModels ? { subagentModels: cfg.subagentModels } : {})
  }
}

export function settingsToConfig(settings: MeowSettings, base: MeowConfig = DEFAULT_MEOW_CONFIG): MeowConfig {
  const providers: Record<string, MeowProviderConfig> = {}
  for (const p of settings.providers) {
    const models = (p.models ?? []).filter(m => typeof m === 'string' && m.trim() !== '')
    if (!p.id.trim()) continue
    providers[p.id.trim()] = {
      apiKey: p.apiKey || undefined,
      keyRef: p.keyRef || undefined,
      baseUrl: p.baseUrl || undefined,
      models,
      apiKeyEnv: p.apiKey || p.keyRef ? undefined : `${p.id.trim().toUpperCase()}_API_KEY`
    }
  }
  const defaultProvider = providers[settings.defaultProvider] ? settings.defaultProvider : (Object.keys(providers)[0] ?? '')
  const agents: Record<string, MeowAgentConfig> = {}
  for (const a of settings.agents ?? []) {
    if (!a.name.trim()) continue
    agents[a.name.trim()] = {
      provider: a.provider,
      model: a.model,
      accountId: a.accountId,
      systemPrompt: a.systemPrompt
    }
  }
  return {
    provider: providers,
    model: defaultProvider,
    agents: Object.keys(agents).length > 0 ? agents : (base.agents ?? DEFAULT_MEOW_CONFIG.agents),
    permission: settings.permission
      ? { ...DEFAULT_MEOW_CONFIG.permission, ...settings.permission }
      : (base.permission ?? DEFAULT_MEOW_CONFIG.permission),
    mcp: normalizeMcp(settings.mcp ?? base.mcp ?? {}),
    maxContextTokens: settings.maxContextTokens ?? base.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    maxOutputTokens: settings.maxOutputTokens ?? base.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxSteps: settings.maxSteps ?? base.maxSteps ?? DEFAULT_MAX_STEPS,
    compaction: settings.compaction ? normalizeCompaction(settings.compaction) : normalizeCompaction(base.compaction),
    toolOutput: settings.toolOutput ? normalizeToolOutput(settings.toolOutput) : normalizeToolOutput(base.toolOutput),
    lsp: settings.lsp ? normalizeLsp(settings.lsp) : normalizeLsp(base.lsp),
    notifications: settings.notifications
      ? normalizeNotifications(settings.notifications)
      : normalizeNotifications(base.notifications),
    trace: normalizeTrace(settings.trace ?? base.trace),
    ...(settings.subagentModels
      ? { subagentModels: normalizeSubagentModels(settings.subagentModels, providers) }
      : {})
  }
}

export function writeMeowConfig(filePath: string, cfg: MeowConfig): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(cfg, null, 2))
}
