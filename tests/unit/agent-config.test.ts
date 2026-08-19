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
  it('uses empty providers when the file does not exist', () => {
    const cfg = loadMeowConfig(path.join(dir, 'missing.json'))
    expect(cfg.model).toBe('')
    expect(cfg.provider).toEqual({})
    expect(cfg.agents.meow.systemPrompt).toBeTruthy()
    expect(cfg.agents.meow.systemPrompt).toMatch(/question tool/i)
    // The "use search tools extensively" filler was dropped to keep the
    // per-request system prompt lean.
    expect(cfg.agents.meow.systemPrompt).not.toMatch(/search tools/i)
  })

  it('uses empty providers when the file is corrupt', () => {
    writeFileSync(file, '{not json')
    const cfg = loadMeowConfig(file)
    expect(cfg.provider).toEqual({})
    expect(cfg.agents.meow.systemPrompt).toBeTruthy()
  })

  it('parses a valid meow.json with models lists', () => {
    writeFileSync(file, JSON.stringify({
      provider: {
        anthropic: { apiKey: 'sk-test', models: ['claude-opus-4-1', 'claude-sonnet-4-5'] },
        openai: { baseUrl: 'http://localhost:11434/v1', models: ['llama3'] }
      },
      model: 'openai',
      agents: { meow: { systemPrompt: 'You are Meow.' } },
      permission: { bash: 'allow' }
    }))
    const cfg = loadMeowConfig(file)
    expect(cfg.model).toBe('openai')
    expect(cfg.provider.anthropic.models).toEqual(['claude-opus-4-1', 'claude-sonnet-4-5'])
    expect(cfg.provider.openai.baseUrl).toBe('http://localhost:11434/v1')
    expect(cfg.agents.meow.systemPrompt).toBe('You are Meow.')
    expect(cfg.permission.bash).toBe('allow')
  })

  it('migrates a legacy provider model string into models', () => {
    writeFileSync(file, JSON.stringify({
      provider: { anthropic: { model: 'claude-opus-4-1' } },
      model: 'anthropic'
    }))
    const cfg = loadMeowConfig(file)
    expect(cfg.provider.anthropic.models).toEqual(['claude-opus-4-1'])
  })
})

describe('resolveApiKey', () => {
  it('prefers an inline api key over the env var', () => {
    const p = { apiKey: 'inline', apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['m'] }
    expect(resolveApiKey(p, { ANTHROPIC_API_KEY: 'env' })).toBe('inline')
  })

  it('falls back to the env var named by apiKeyEnv', () => {
    const p = { apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['m'] }
    expect(resolveApiKey(p, { ANTHROPIC_API_KEY: 'env-key' })).toBe('env-key')
  })

  it('returns null when no key is available', () => {
    const p = { apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['m'] }
    expect(resolveApiKey(p, {})).toBeNull()
  })
})

describe('resolveAgentConfig', () => {
  function cfgWithProviders() {
    const c = loadMeowConfig(file)
    c.provider = {
      anthropic: { apiKey: 'sk', models: ['claude-sonnet-4-5'] },
      openai: { baseUrl: 'http://localhost:11434/v1', models: ['llama3', 'qwen'] }
    }
    c.model = 'anthropic'
    return c
  }

  it('resolves the default meow agent and first model', () => {
    const cfg = cfgWithProviders()
    const resolved = resolveAgentConfig(cfg, 'meow', {})
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe('claude-sonnet-4-5')
    expect(resolved.apiKey).toBe('sk')
    expect(resolved.systemPrompt).toBe(cfg.agents.meow.systemPrompt)
  })

  it('uses an agentModel override to pick provider and model', () => {
    const cfg = cfgWithProviders()
    const resolved = resolveAgentConfig(cfg, 'meow', {}, 'openai/qwen')
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe('qwen')
  })

  it('uses a legacy agent.model provider reference', () => {
    const cfg = cfgWithProviders()
    cfg.agents.meow = { model: 'openai', systemPrompt: 'p' }
    const resolved = resolveAgentConfig(cfg, 'meow', {})
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe('llama3')
  })

  it('returns an empty provider when nothing is configured', () => {
    const cfg = loadMeowConfig(file)
    const resolved = resolveAgentConfig(cfg, 'meow', {})
    expect(resolved.provider).toBe('')
    expect(resolved.model).toBe('')
    expect(resolved.apiKey).toBeNull()
  })

  it('exposes defaults exported for reuse', () => {
    expect(DEFAULT_MEOW_CONFIG.agents.meow).toBeDefined()
    expect(DEFAULT_MEOW_CONFIG.provider).toEqual({})
  })
})

describe('configToSettings / settingsToConfig', () => {
  it('round-trips providers and the default provider', () => {
    const cfg = cfgWithProviders()
    const settings = configToSettings(cfg)
    expect(settings.defaultProvider).toBe('anthropic')
    expect(settings.providers.map(p => p.id)).toContain('anthropic')
    expect(settings.providers.map(p => p.id)).toContain('openai')
    expect(settings.providers.find(p => p.id === 'openai')?.models).toEqual(['llama3', 'qwen'])
    const back = settingsToConfig(settings, cfg)
    expect(back.model).toBe('anthropic')
    expect(back.provider.anthropic.models).toEqual(['claude-sonnet-4-5'])
  })

  it('maps an inline apiKey and clears apiKeyEnv', () => {
    const settings = {
      defaultProvider: 'deepseek',
      providers: [
        { id: 'deepseek', apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] }
      ]
    }
    const cfg = settingsToConfig(settings, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.deepseek.apiKey).toBe('sk-ds')
    expect(cfg.provider.deepseek.apiKeyEnv).toBeUndefined()
    expect(cfg.provider.deepseek.models).toEqual(['deepseek-chat'])
  })

  it('keeps the env fallback when apiKey is empty', () => {
    const settings = {
      defaultProvider: 'anthropic',
      providers: [{ id: 'anthropic', apiKey: '', models: ['claude-x'] }]
    }
    const cfg = settingsToConfig(settings, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.anthropic.apiKey).toBeUndefined()
    expect(cfg.provider.anthropic.apiKeyEnv).toBe('ANTHROPIC_API_KEY')
  })

  it('preserves agents and permission from the base config', () => {
    const base = cfgWithProviders()
    base.permission = { bash: 'deny' }
    const settings = {
      defaultProvider: 'openai',
      providers: [{ id: 'openai', apiKey: 'k', models: ['gpt-4o'] }]
    }
    const cfg = settingsToConfig(settings, base)
    expect(cfg.permission.bash).toBe('deny')
    expect(cfg.agents.meow.systemPrompt).toBe(base.agents.meow.systemPrompt)
  })

  it('returns no providers when none remain', () => {
    const cfg = settingsToConfig({ defaultProvider: '', providers: [] }, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider).toEqual({})
    expect(cfg.model).toBe('')
  })

  it('drops providers without an id', () => {
    const cfg = settingsToConfig({
      defaultProvider: '',
      providers: [
        { id: '', apiKey: '', models: [] },
        { id: 'ok', apiKey: '', models: ['m1'] }
      ]
    }, DEFAULT_MEOW_CONFIG)
    expect(Object.keys(cfg.provider)).toEqual(['ok'])
  })

  it('keeps a provider with no models (models sync later)', () => {
    const cfg = settingsToConfig({
      defaultProvider: 'x',
      providers: [{ id: 'x', apiKey: 'k', models: [] }]
    }, DEFAULT_MEOW_CONFIG)
    expect(cfg.provider.x.models).toEqual([])
    expect(cfg.provider.x.apiKey).toBe('k')
  })

  it('writeMeowConfig persists a config that loadMeowConfig can read', () => {
    const cfg = settingsToConfig({
      defaultProvider: 'deepseek',
      providers: [
        { id: 'deepseek', apiKey: 'sk', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] }
      ]
    }, DEFAULT_MEOW_CONFIG)
    writeMeowConfig(file, cfg)
    const read = loadMeowConfig(file)
    expect(read.model).toBe('deepseek')
    expect(read.provider.deepseek?.apiKey).toBe('sk')
    expect(read.provider.deepseek?.models).toEqual(['deepseek-chat'])
  })

  it('preserves mcp servers from the base config', () => {
    const base = cfgWithProviders()
    base.mcp = { mytools: { command: 'npx', args: ['-y', '@foo/bar'] } }
    const cfg = settingsToConfig({
      defaultProvider: 'openai',
      providers: [{ id: 'openai', apiKey: 'k', models: ['gpt-4o'] }]
    }, base)
    expect(cfg.mcp.mytools.command).toBe('npx')
  })

  it('splits a full command string into command + args', () => {
    writeFileSync(file, JSON.stringify({ mcp: { playwright: { command: 'npx @playwright/mcp' } } }))
    const cfg = loadMeowConfig(file)
    expect(cfg.mcp.playwright.command).toBe('npx')
    expect(cfg.mcp.playwright.args).toEqual(['@playwright/mcp'])
  })

  it('keeps existing args when a command string is also present', () => {
    writeFileSync(file, JSON.stringify({ mcp: { t: { command: 'npx -y @foo/bar', args: ['-y', '@foo/bar'] } } }))
    const cfg = loadMeowConfig(file)
    expect(cfg.mcp.t.command).toBe('npx -y @foo/bar')
    expect(cfg.mcp.t.args).toEqual(['-y', '@foo/bar'])
  })

  it('defaults to token-based compaction settings', () => {
    const cfg = loadMeowConfig(file)
    expect(cfg.maxContextTokens).toBe(128000)
    expect(cfg.maxSteps).toBe(Infinity)
    expect(cfg.compaction).toEqual({
      auto: true,
      buffer: 20000,
      keepTokens: 8000,
      tailTurns: 2,
      toolOutputMaxChars: 2000,
      prune: true
    })
    expect(cfg.toolOutput).toEqual({ maxBytes: 51200, maxLines: 2000 })
    expect(cfg.lsp).toEqual({ enabled: true, diagnosticsTimeoutMs: 3000 })
    expect(cfg.notifications).toEqual({ needsInput: true, onDone: true })
  })

  it('normalizes notifications settings', () => {
    writeFileSync(file, JSON.stringify({ notifications: { needsInput: false } }))
    const cfg = loadMeowConfig(file)
    expect(cfg.notifications).toEqual({ needsInput: false, onDone: true })
  })

  it('reads custom compaction settings from config', () => {
    writeFileSync(file, JSON.stringify({
      provider: { deepseek: { apiKey: 'sk', models: ['deepseek-chat'] } },
      model: 'deepseek',
      maxContextTokens: 64000,
      compaction: { auto: false, buffer: 1000, keepTokens: 2000, tailTurns: 3, toolOutputMaxChars: 500 }
    }))
    const cfg = loadMeowConfig(file)
    expect(cfg.maxContextTokens).toBe(64000)
    expect(cfg.compaction.auto).toBe(false)
    expect(cfg.compaction.buffer).toBe(1000)
    expect(cfg.compaction.keepTokens).toBe(2000)
    expect(cfg.compaction.tailTurns).toBe(3)
    expect(cfg.compaction.toolOutputMaxChars).toBe(500)
  })

  it('preserves compaction settings through settingsToConfig', () => {
    const base = cfgWithProviders()
    base.compaction = { auto: false, buffer: 5000, keepTokens: 1000, tailTurns: 1, toolOutputMaxChars: 300 }
    const cfg = settingsToConfig({
      defaultProvider: 'anthropic',
      providers: [{ id: 'anthropic', apiKey: 'sk', models: ['claude-x'] }]
    }, base)
    expect(cfg.compaction.auto).toBe(false)
    expect(cfg.compaction.buffer).toBe(5000)
    expect(cfg.compaction.keepTokens).toBe(1000)
    expect(cfg.compaction.tailTurns).toBe(1)
    expect(cfg.compaction.toolOutputMaxChars).toBe(300)
  })

  it('round-trips the full settings object (agents, permission, mcp, context)', () => {
    const cfg = cfgWithProviders()
    cfg.agents = {
      meow: { systemPrompt: 'You are Meow.' },
      reviewer: { provider: 'openai', model: 'qwen', systemPrompt: 'You review.' }
    }
    cfg.permission = { bash: 'ask', write: 'allow', edit: 'deny' }
    cfg.mcp = { mytools: { command: 'npx', args: ['-y', '@foo/bar'] } }
    cfg.maxContextTokens = 123000
    cfg.maxSteps = 300
    cfg.compaction = { auto: false, buffer: 7000, keepTokens: 900, tailTurns: 1, toolOutputMaxChars: 400, prune: false }
    cfg.toolOutput = { maxBytes: 100000, maxLines: 500 }

    const settings = configToSettings(cfg)
    expect(settings.agents.find(a => a.name === 'meow')?.systemPrompt).toBe('You are Meow.')
    expect(settings.agents.find(a => a.name === 'reviewer')).toMatchObject({ provider: 'openai', model: 'qwen' })
    expect(settings.permission.bash).toBe('ask')
    expect(settings.mcp.mytools).toEqual({ command: 'npx', args: ['-y', '@foo/bar'] })
    expect(settings.maxContextTokens).toBe(123000)
    expect(settings.maxSteps).toBe(300)
    expect(settings.compaction.tailTurns).toBe(1)

    const back = settingsToConfig(settings, cfg)
    expect(back.agents.reviewer).toMatchObject({ provider: 'openai', model: 'qwen', systemPrompt: 'You review.' })
    expect(back.permission).toMatchObject({ bash: 'ask', write: 'allow', edit: 'deny' })
    expect(back.mcp.mytools.command).toBe('npx')
    expect(back.maxContextTokens).toBe(123000)
    expect(back.maxSteps).toBe(300)
    expect(back.compaction).toEqual({ auto: false, buffer: 7000, keepTokens: 900, tailTurns: 1, toolOutputMaxChars: 400, prune: false })
    expect(back.toolOutput).toEqual({ maxBytes: 100000, maxLines: 500 })
    expect(back.lsp).toEqual({ enabled: true, diagnosticsTimeoutMs: 3000 })
  })

  it('defaults trace to disabled and round-trips trace.enabled', () => {
    const cfg = cfgWithProviders()
    expect(cfg.trace).toEqual({ enabled: false })
    expect(configToSettings(cfg).trace).toEqual({ enabled: false })

    cfg.trace = { enabled: true }
    const settings = configToSettings(cfg)
    expect(settings.trace).toEqual({ enabled: true })

    const back = settingsToConfig(settings, cfg)
    expect(back.trace).toEqual({ enabled: true })
  })
})

describe('subagentModels', () => {
  const write = (sub: unknown) => {
    writeFileSync(file, JSON.stringify({
      provider: { p1: { apiKey: 'k', models: ['m1', 'm2'] } },
      model: 'p1',
      subagentModels: sub
    }))
    return loadMeowConfig(file)
  }

  it('keeps valid role models', () => {
    const c = write({ research: { provider: 'p1', model: 'm2' } })
    expect(c.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
  })

  it('drops roles whose model is not in provider.models (fallback to main)', () => {
    const c = write({ general: { provider: 'p1', model: 'nope' } })
    expect(c.subagentModels).toBeUndefined()
  })

  it('drops roles whose provider is missing', () => {
    const c = write({ reviewer: { provider: 'ghost', model: 'm1' } })
    expect(c.subagentModels).toBeUndefined()
  })

  it('round-trips through configToSettings/settingsToConfig', () => {
    const loaded = write({ research: { provider: 'p1', model: 'm2' } })
    const s = configToSettings(loaded)
    expect(s.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
    const back = settingsToConfig(s, loaded)
    expect(back.subagentModels).toEqual({ research: { provider: 'p1', model: 'm2' } })
  })
})

function cfgWithProviders() {
  const c = loadMeowConfig(file)
  c.provider = {
    anthropic: { apiKey: 'sk', models: ['claude-sonnet-4-5'] },
    openai: { baseUrl: 'http://localhost:11434/v1', models: ['llama3', 'qwen'] }
  }
  c.model = 'anthropic'
  return c
}
