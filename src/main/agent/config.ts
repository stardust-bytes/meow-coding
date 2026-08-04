import { existsSync, readFileSync } from 'node:fs'

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
}

export interface ResolvedAgentConfig {
  provider: string
  model: string
  apiKey: string | null
  baseUrl?: string
  systemPrompt: string
}

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
  permission: {}
}

function mergeDefaults(raw: Partial<MeowConfig>): MeowConfig {
  const provider = { ...DEFAULT_MEOW_CONFIG.provider, ...(raw.provider ?? {}) }
  const agents = { ...DEFAULT_MEOW_CONFIG.agents, ...(raw.agents ?? {}) }
  return {
    provider,
    model: raw.model ?? DEFAULT_MEOW_CONFIG.model,
    agents,
    permission: raw.permission ?? {}
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
