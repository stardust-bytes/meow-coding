import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MeowSettings } from '../../shared/types'
import type { McpServerConfig } from './mcp/manager'

export type PermissionRule = 'allow' | 'ask' | 'deny'

export interface MeowProviderConfig {
  apiKeyEnv?: string
  apiKey?: string
  baseUrl?: string
  models: string[]
}

export interface MeowAgentConfig {
  provider?: string
  model?: string
  systemPrompt: string
}

export interface MeowConfig {
  provider: Record<string, MeowProviderConfig>
  model: string
  agents: Record<string, MeowAgentConfig>
  permission: Record<string, PermissionRule>
  mcp: Record<string, McpServerConfig>
  maxContextChars: number
}

export interface ResolvedAgentConfig {
  provider: string
  model: string
  apiKey: string | null
  baseUrl?: string
  systemPrompt: string
}

export const DEFAULT_MAX_CONTEXT_CHARS = 200000

export const DEFAULT_MEOW_CONFIG: MeowConfig = {
  provider: {},
  model: '',
  agents: {
    meow: {
      systemPrompt: 'You are Meow, a coding agent running inside the Meow Coding desktop app. ' +
        'You help the user build and maintain their codebase. You have access to tools like ' +
        'bash, read, write, edit, glob, grep, apply-patch and todowrite. Read files before ' +
        'editing them, run tests after changes, and keep answers concise.'
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
    question: 'ask'
  },
  mcp: {},
  maxContextChars: DEFAULT_MAX_CONTEXT_CHARS
}

type RawProvider = Partial<MeowProviderConfig> & Record<string, unknown>

function normalizeProvider(raw: RawProvider): MeowProviderConfig {
  const models = Array.isArray(raw.models)
    ? (raw.models as string[]).filter(m => typeof m === 'string' && m.trim() !== '')
    : typeof raw.model === 'string' && raw.model
      ? [raw.model]
      : []
  return {
    apiKeyEnv: raw.apiKeyEnv,
    apiKey: raw.apiKey,
    baseUrl: raw.baseUrl,
    models
  }
}

function normalizeAgents(raw: Record<string, unknown> | undefined): Record<string, MeowAgentConfig> {
  const base = DEFAULT_MEOW_CONFIG.agents
  if (!raw) return base
  const out: Record<string, MeowAgentConfig> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Partial<MeowAgentConfig> & Record<string, unknown>
    const legacyModel = typeof v.model === 'string' ? v.model : undefined
    const isProviderRef = legacyModel !== undefined && !legacyModel.includes('/')
    out[name] = {
      provider: typeof v.provider === 'string' ? v.provider : (isProviderRef ? legacyModel : undefined),
      model: typeof v.model === 'string' && !isProviderRef ? v.model : undefined,
      systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : (base[name]?.systemPrompt ?? base.meow.systemPrompt)
    }
  }
  return { ...base, ...out }
}

function mergeDefaults(raw: Partial<MeowConfig>): MeowConfig {
  const providers: Record<string, MeowProviderConfig> = {}
  for (const [id, p] of Object.entries(raw.provider ?? {})) {
    providers[id] = normalizeProvider(p as RawProvider)
  }
  return {
    provider: providers,
    model: raw.model ?? DEFAULT_MEOW_CONFIG.model,
    agents: normalizeAgents(raw.agents),
    permission: { ...DEFAULT_MEOW_CONFIG.permission, ...(raw.permission ?? {}) },
    mcp: raw.mcp ?? {},
    maxContextChars: raw.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS
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
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (provider.apiKey) return provider.apiKey
  if (provider.apiKeyEnv) return env[provider.apiKeyEnv] ?? null
  return null
}

export function resolveAgentConfig(
  cfg: MeowConfig,
  agentName: string,
  env: NodeJS.ProcessEnv = process.env,
  agentModel?: string
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
  const provider = cfg.provider[providerName]
  if (!provider) {
    return { provider: '', model: '', apiKey: null, systemPrompt: agent.systemPrompt }
  }
  const model = modelName && provider.models.includes(modelName) ? modelName : (provider.models[0] ?? '')
  return {
    provider: providerName,
    model,
    apiKey: resolveApiKey(provider, env),
    baseUrl: provider.baseUrl,
    systemPrompt: agent.systemPrompt
  }
}

export function configToSettings(cfg: MeowConfig): MeowSettings {
  return {
    providers: Object.entries(cfg.provider).map(([id, p]) => ({
      id,
      apiKey: p.apiKey ?? '',
      baseUrl: p.baseUrl,
      models: p.models
    })),
    defaultProvider: cfg.model
  }
}

export function settingsToConfig(settings: MeowSettings, base: MeowConfig = DEFAULT_MEOW_CONFIG): MeowConfig {
  const providers: Record<string, MeowProviderConfig> = {}
  for (const p of settings.providers) {
    const models = (p.models ?? []).filter(m => typeof m === 'string' && m.trim() !== '')
    if (!p.id.trim()) continue
    providers[p.id.trim()] = {
      apiKey: p.apiKey || undefined,
      baseUrl: p.baseUrl || undefined,
      models,
      apiKeyEnv: p.apiKey ? undefined : `${p.id.trim().toUpperCase()}_API_KEY`
    }
  }
  const defaultProvider = providers[settings.defaultProvider] ? settings.defaultProvider : (Object.keys(providers)[0] ?? '')
  return {
    provider: providers,
    model: defaultProvider,
    agents: base.agents ?? DEFAULT_MEOW_CONFIG.agents,
    permission: base.permission ?? {},
    mcp: base.mcp ?? {},
    maxContextChars: Math.max(base.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS, DEFAULT_MAX_CONTEXT_CHARS)
  }
}

export function writeMeowConfig(filePath: string, cfg: MeowConfig): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(cfg, null, 2))
}
