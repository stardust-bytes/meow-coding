import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ModelsCatalog } from '../../src/main/models-catalog'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response
}

describe('ModelsCatalog', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-cat-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('maps the models.dev catalog into provider/model lists', async () => {
    const fetchFn = async () => jsonResponse({
      deepseek: { name: 'DeepSeek', models: { 'deepseek-chat': {}, 'deepseek-reasoner': {} } },
      openai: { name: 'OpenAI', models: { 'gpt-4o': {}, 'gpt-4o-mini': {} } }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.deepseek.name).toBe('DeepSeek')
    expect(providers.deepseek.models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(providers.openai.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('keeps model context/output limits from models.dev', async () => {
    const fetchFn = async () => jsonResponse({
      deepseek: {
        name: 'DeepSeek',
        models: {
          'deepseek-chat': { limit: { context: 64000, output: 8192 } },
          'deepseek-reasoner': { limit: { context: 64000 } },
          'plain': {}
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.deepseek.limits?.['deepseek-chat']).toEqual({ context: 64000, output: 8192 })
    expect(providers.deepseek.limits?.['deepseek-reasoner']).toEqual({ context: 64000, output: undefined })
    expect(providers.deepseek.limits?.['plain']).toBeUndefined()
    expect(await catalog.getModelLimit('deepseek', 'deepseek-chat')).toEqual({ context: 64000, output: 8192 })
    expect(await catalog.getModelLimit('deepseek', 'plain')).toBeUndefined()
  })

  it('returns [] for an unknown provider and falls back to the snapshot offline', async () => {
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () => jsonResponse({}))
    const providers = await catalog.fetch()
    expect(providers.unknown).toBeUndefined()
    const failing = new ModelsCatalog(path.join(dir, 'models2.json'), async () => { throw new Error('offline') })
    const snapshot = await failing.fetch()
    expect(snapshot.openai).toBeDefined()
    expect(snapshot.deepseek).toBeDefined()
    expect(snapshot.openai.models.length).toBeGreaterThan(0)
  })

  it('merges live data over the bundled snapshot', async () => {
    const fetchFn = async () => jsonResponse({
      deepseek: { name: 'DeepSeek', models: { 'deepseek-chat': {}, 'deepseek-reasoner': {} } }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.deepseek.models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    // providers not in the live response still come from the snapshot
    expect(providers.openai).toBeDefined()
  })

  it('serves the cache within ttl without refetching', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return jsonResponse({ deepseek: { name: 'DeepSeek', models: { a: {} } } })
    }
    const file = path.join(dir, 'models.json')
    const catalog = new ModelsCatalog(file, fetchFn)
    await catalog.fetch()
    await catalog.fetch()
    expect(calls).toBe(1)
    // cache is on disk and still fresh
    const fresh = new ModelsCatalog(file, fetchFn)
    await fresh.fetch()
    expect(calls).toBe(1)
  })

  it('refetches after ttl expires', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return jsonResponse({ deepseek: { name: 'DeepSeek', models: { a: {} } } })
    }
    const file = path.join(dir, 'models.json')
    const catalog = new ModelsCatalog(file, fetchFn)
    await catalog.fetch()
    // write an expired cache entry
    writeFileSync(file, JSON.stringify({ fetchedAt: Date.now() - 10 * 60_000, providers: { deepseek: { name: 'D', models: ['a'] } } }))
    await catalog.fetch()
    expect(calls).toBe(2)
  })

  it('tolerates a corrupt cache file', async () => {
    const file = path.join(dir, 'models.json')
    writeFileSync(file, 'not-json{{{')
    const catalog = new ModelsCatalog(file, async () => jsonResponse({ deepseek: { name: 'D', models: { a: {} } } }))
    const providers = await catalog.fetch()
    expect(providers.deepseek.models).toEqual(['a'])
    expect(readFileSync(file, 'utf-8')).toContain('fetchedAt')
  })

  it('extracts reasoning effort values per model', async () => {
    const fetchFn = async () => jsonResponse({
      google: {
        name: 'Google',
        models: {
          'gemini-2.5-pro': {
            reasoning: true,
            reasoning_options: [
              { type: 'effort', values: ['none', 'low', 'medium', 'high', 'max'] }
            ]
          },
          'gemini-no-reasoning': {}
        }
      },
      anthropic: {
        name: 'Anthropic',
        models: {
          'claude-opus-4-5': {
            reasoning: true,
            reasoning_options: [
              { type: 'budget_tokens', min: 1024, max: 32000 },
              { type: 'toggle' }
            ]
          }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    const providers = await catalog.fetch()
    expect(providers.google?.variants?.['gemini-2.5-pro']).toEqual(['none', 'low', 'medium', 'high', 'max'])
    expect(providers.google?.variants?.['gemini-no-reasoning']).toBeUndefined()
    expect(providers.anthropic?.variants?.['claude-opus-4-5']).toBeUndefined()
  })

  it('getVariants returns the list for a known model', async () => {
    const fetchFn = async () => jsonResponse({
      google: {
        name: 'Google',
        models: {
          'gemini-2.5-pro': {
            reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
          }
        }
      }
    })
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), fetchFn)
    expect(await catalog.getVariants('google', 'gemini-2.5-pro')).toEqual(['low', 'medium', 'high'])
    expect(await catalog.getVariants('google', 'unknown-model')).toEqual([])
    expect(await catalog.getVariants('unknown-provider', 'x')).toEqual([])
  })
})
