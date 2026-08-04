import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_MEOW_CONFIG,
  configToSettings,
  loadMeowConfig,
  resolveAgentConfig,
  resolveApiKey,
  settingsToConfig,
  writeMeowConfig
} from '../../src/main/agent/config'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-cfg-'))
  file = path.join(dir, 'meow.json')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('loadMeowConfig', () => {
  it('uses defaults when the file does not exist', () => {
    const cfg = loadMeowConfig(path.join(dir, 'missing.json'))
    expect(cfg.model).toBe('anthropic')
    expect(cfg.provider.anthropic.model).toBeTruthy()
    expect(cfg.agents.meow.systemPrompt).toBeTruthy()
  })

  it('uses defaults when the file is corrupt', () => {
    writeFileSync(file, '{not json')
    const cfg = loadMeowConfig(file)
    expect(cfg.model).toBe('anthropic')
    expect(cfg.agents.meow.systemPrompt).toBeTruthy()
  })

  it('parses a valid meow.json', () => {
    writeFileSync(file, JSON.stringify({
      provider: {
        anthropic: { apiKey: 'sk-test', model: 'claude-opus-4-1' },
        openai: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' }
      },
      model: 'openai',
      agents: { meow: { systemPrompt: 'You are Meow.' } },
      permission: { bash: 'allow' }
    }))
    const cfg = loadMeowConfig(file)
    expect(cfg.model).toBe('openai')
    expect(cfg.provider.anthropic.model).toBe('claude-opus-4-1')
    expect(cfg.provider.openai.baseUrl).toBe('http://localhost:11434/v1')
    expect(cfg.agents.meow.systemPrompt).toBe('You are Meow.')
    expect(cfg.permission.bash).toBe('allow')
  })
})

describe('resolveApiKey', () => {
  it('prefers an inline api key over the env var', () => {
    const p = { apiKey: 'inline', apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'm' }
    expect(resolveApiKey(p, { ANTHROPIC_API_KEY: 'env' })).toBe('inline')
  })

  it('falls back to the env var named by apiKeyEnv', () => {
    const p = { apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'm' }
    expect(resolveApiKey(p, { ANTHROPIC_API_KEY: 'env-key' })).toBe('env-key')
  })

  it('returns null when no key is available', () => {
    const p = { apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'm' }
    expect(resolveApiKey(p, {})).toBeNull()
  })
})

describe('resolveAgentConfig', () => {
  it('resolves the default meow agent with no key set', () => {
    const cfg = loadMeowConfig(file)
    const resolved = resolveAgentConfig(cfg, 'meow', {})
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(cfg.provider.anthropic.model)
    expect(resolved.apiKey).toBeNull()
    expect(resolved.systemPrompt).toBe(cfg.agents.meow.systemPrompt)
  })

  it('uses an agents.model override to pick a provider', () => {
    const cfg = loadMeowConfig(file)
    cfg.agents.meow = { model: 'openai', systemPrompt: 'p' }
    const resolved = resolveAgentConfig(cfg, 'meow', {})
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe(cfg.provider.openai.model)
  })

  it('throws for an unknown provider', () => {
    const cfg = loadMeowConfig(file)
    cfg.model = 'nonexistent'
    expect(() => resolveAgentConfig(cfg, 'meow', {})).toThrow()
  })

  it('exposes defaults exported for reuse', () => {
    expect(DEFAULT_MEOW_CONFIG.agents.meow).toBeDefined()
    expect(DEFAULT_MEOW_CONFIG.provider.anthropic).toBeDefined()
  })
})

describe('configToSettings / settingsToConfig', () => {
  it('round-trips providers and the default provider', () => {
    const cfg = loadMeowConfig(file)
    const settings = configToSettings(cfg)
    expect(settings.defaultProvider).toBe('anthropic')
    expect(settings.providers.map(p => p.id)).toContain('anthropic')
    expect(settings.providers.map(p => p.id)).toContain('openai')
    const back = settingsToConfig(settings, cfg)
    expect(back.model).toBe('anthropic')
    expect(back.provider.anthropic.model).toBe(cfg.provider.anthropic.model)
  })

  it('maps an inline apiKey and clears apiKeyEnv', () => {
    const settings = {
      defaultProvider: 'deepseek',
      providers: [
        { id: 'deepseek', apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
      ]
    }
    const cfg = settingsToConfig(settings, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.deepseek.apiKey).toBe('sk-ds')
    expect(cfg.provider.deepseek.apiKeyEnv).toBeUndefined()
    expect(cfg.provider.deepseek.model).toBe('deepseek-chat')
  })

  it('keeps the env fallback when apiKey is empty', () => {
    const settings = {
      defaultProvider: 'anthropic',
      providers: [{ id: 'anthropic', apiKey: '', model: 'claude-x' }]
    }
    const cfg = settingsToConfig(settings, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.anthropic.apiKey).toBeUndefined()
    expect(cfg.provider.anthropic.apiKeyEnv).toBe('ANTHROPIC_API_KEY')
  })

  it('preserves agents and permission from the base config', () => {
    const base = loadMeowConfig(file)
    base.permission = { bash: 'deny' }
    const settings = {
      defaultProvider: 'openai',
      providers: [{ id: 'openai', apiKey: 'k', model: 'gpt-4o' }]
    }
    const cfg = settingsToConfig(settings, base)
    expect(cfg.permission.bash).toBe('deny')
    expect(cfg.agents.meow.systemPrompt).toBe(base.agents.meow.systemPrompt)
  })

  it('falls back to defaults when no provider remains', () => {
    const cfg = settingsToConfig({ defaultProvider: '', providers: [] }, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.anthropic).toBeDefined()
  })

  it('writeMeowConfig persists a config that loadMeowConfig can read', () => {
    const cfg = settingsToConfig({
      defaultProvider: 'deepseek',
      providers: [
        { id: 'deepseek', apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
      ]
    }, DEFAULT_MEOW_CONFIG)
    writeMeowConfig(file, cfg)
    const read = loadMeowConfig(file)
    expect(read.model).toBe('deepseek')
    expect(read.provider.deepseek?.apiKey).toBe('sk')
  })
})
