import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MeowSettings } from '../../shared/types'
import type { McpServerConfig } from './mcp/manager'

export type PermissionRule = 'allow' | 'ask' | 'deny'

export interface MeowProviderConfig {
  apiKeyEnv?: string
  apiKey?: string
  baseUrl?: string
  model: string
}

export interface MeowAgentConfig {
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

export const DEFAULT_MAX_CONTEXT_CHARS = 30000

export const DEFAULT_MEOW_CONFIG: MeowConfig = {
  provider: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5' },
    openai: { apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4o' }
  },
  model: 'anthropic',
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
    bash: 'ask',
    question: 'ask'
  },
  mcp: {},
  maxContextChars: DEFAULT_MAX_CONTEXT_CHARS
}

function mergeDefaults(raw: Partial<MeowConfig>): MeowConfig {
  const provider = { ...DEFAULT_MEOW_CONFIG.provider, ...(raw.provider ?? {}) }
  const agents = { ...DEFAULT_MEOW_CONFIG.agents, ...(raw.agents ?? {}) }
  return {
    provider,
    model: raw.model ?? DEFAULT_MEOW_CONFIG.model,
    agents,
    permission: raw.permission ?? DEFAULT_MEOW_CONFIG.permission,
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
  env: NodeJS.ProcessEnv = process.env
): ResolvedAgentConfig {
  const agent = cfg.agents[agentName] ?? cfg.agents.meow
  const providerName = agent.model ?? cfg.model
  const provider = cfg.provider[providerName]
  if (!provider) throw new Error(`Unknown provider "${providerName}" for agent "${agentName}"`)
  return {
    provider: providerName,
    model: provider.model,
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
      model: p.model
    })),
    defaultProvider: cfg.model
  }
}

export function settingsToConfig(settings: MeowSettings, base: MeowConfig = DEFAULT_MEOW_CONFIG): MeowConfig {
  if (settings.providers.length === 0) return mergeDefaults({})
  const providers: Record<string, MeowProviderConfig> = {}
  for (const p of settings.providers) {
    providers[p.id] = {
      apiKey: p.apiKey || undefined,
      baseUrl: p.baseUrl || undefined,
      model: p.model,
      apiKeyEnv: p.apiKey ? undefined : `${p.id.toUpperCase()}_API_KEY`
    }
  }
  const defaultProvider = providers[settings.defaultProvider]
    ? settings.defaultProvider
    : settings.providers[0].id
  return {
    provider: providers,
    model: defaultProvider,
    agents: base.agents ?? DEFAULT_MEOW_CONFIG.agents,
    permission: base.permission ?? {},
    mcp: base.mcp ?? {},
    maxContextChars: base.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS
  }
}

export function writeMeowConfig(filePath: string, cfg: MeowConfig): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(cfg, null, 2))
}
