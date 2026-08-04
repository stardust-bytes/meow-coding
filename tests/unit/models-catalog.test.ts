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

  it('returns [] for an unknown provider and {} for network failure', async () => {
    const catalog = new ModelsCatalog(path.join(dir, 'models.json'), async () => jsonResponse({}))
    const providers = await catalog.fetch()
    expect(providers.unknown).toBeUndefined()
    const failing = new ModelsCatalog(path.join(dir, 'models2.json'), async () => { throw new Error('offline') })
    expect(await failing.fetch()).toEqual({})
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
})
