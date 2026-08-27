import { describe, expect, it } from 'vitest'
import {
  parseLiveModelsInfo, matchModel, classifyContextOverflowError, parseContextLimitFromError,
  LimitsService
} from '../../src/main/agent/limits'
import type { LimitsServiceDeps, ResolvedLimits } from '../../src/main/agent/limits'
import { LearnedLimitsStore } from '../../src/main/agent/learned-limits'
import type { LearnedLimitEntry } from '../../src/main/agent/learned-limits'
import { MAX_OUTPUT_HARD_CAP } from '../../src/main/agent/config'

describe('parseLiveModelsInfo', () => {
  it('reads context/output from any of the known field names', () => {
    const out = parseLiveModelsInfo({
      data: [
        { id: 'a', context_window: 131072, max_output_tokens: 65536 },
        { id: 'b', max_context_length: 200000, max_tokens: 8192 },
        { id: 'c', context_length: 128000, output_tokens: 4096 }
      ]
    })
    expect(out).toEqual([
      { id: 'a', context: 131072, output: 65536 },
      { id: 'b', context: 200000, output: 8192 },
      { id: 'c', context: 128000, output: 4096 }
    ])
  })

  it('keeps entries without limits and skips garbage', () => {
    expect(parseLiveModelsInfo({ data: [{ id: 'a' }, 42, { id: 'b', context_window: 1000 }] }))
      .toEqual([{ id: 'a' }, { id: 'b', context: 1000 }])
    expect(parseLiveModelsInfo({})).toEqual([])
    expect(parseLiveModelsInfo(null)).toEqual([])
    expect(parseLiveModelsInfo(undefined)).toEqual([])
  })
})

describe('matchModel', () => {
  it('matches exact ids', () => {
    expect(matchModel('deepseek-v4-flash', 'deepseek-v4-flash')).toBe(true)
  })
  it('matches a server :tag against the bare catalog id', () => {
    expect(matchModel('deepseek-v4-flash:0731', 'deepseek-v4-flash')).toBe(true)
    expect(matchModel('deepseek-v4-flash', 'deepseek-v4-flash:0731')).toBe(true)
  })
  it('falls back to containment for namespaced server ids', () => {
    expect(matchModel('accounts/fireworks/models/llama-v3p1-70b-instruct', 'llama-v3p1-70b-instruct')).toBe(true)
  })
  it('rejects unrelated ids', () => {
    expect(matchModel('gpt-5', 'deepseek-v4-flash')).toBe(false)
  })
})

describe('classifyContextOverflowError', () => {
  it('recognizes the known rejection shapes', () => {
    for (const msg of [
      'prompt is too long: 19000 tokens > 16000 maximum',
      'This model\'s maximum context length is 128000 tokens',
      'The request exceeded the maximum context length',
      'context_length_exceeded: requested 200000 tokens',
      'input exceeds the context window of the model',
      'Please reduce the length of the messages or completion',
      'Input token exceed the limit (request id: 20260827151121597191920c955d568RXzzSEEf)'
    ]) {
      expect(classifyContextOverflowError(msg), msg).toBe(true)
    }
  })
  it('ignores unrelated errors, including a max_tokens rejection', () => {
    expect(classifyContextOverflowError('max_tokens (131072) exceeds model\'s maximum output tokens (65536)')).toBe(false)
    expect(classifyContextOverflowError('bad api key')).toBe(false)
    expect(classifyContextOverflowError(undefined)).toBe(false)
  })
})

describe('parseContextLimitFromError', () => {
  it('extracts the cap from OpenAI and Anthropic messages', () => {
    expect(parseContextLimitFromError('This model\'s maximum context length is 128000 tokens. However, you requested 200000 tokens.')).toBe(128000)
    expect(parseContextLimitFromError('prompt is too long: 19000 tokens > 16000 maximum')).toBe(16000)
  })
  it('returns undefined when no cap is named', () => {
    expect(parseContextLimitFromError('context_length_exceeded')).toBeUndefined()
    expect(parseContextLimitFromError(undefined)).toBeUndefined()
  })
})

describe('LimitsService', () => {
  const CATALOG: LimitsServiceDeps['getCatalogLimit'] = async () => ({ context: 200000, output: 384000 })

  function makeService(over: Partial<LimitsServiceDeps> = {}) {
    const data: LearnedLimitEntry[] = []
    const learned = new LearnedLimitsStore({ load: () => data, save: (next) => data.splice(0, data.length, ...next) })
    const clock = { now: 1000 }
    const deps: LimitsServiceDeps = { learned, now: () => clock.now, ...over }
    return { service: new LimitsService(deps), clock, learned }
  }

  it('prefers user overrides over everything else', async () => {
    const { service } = makeService()
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', overrides: { context: 64000, output: 8192 } })
    expect(limits).toEqual({ context: 64000, output: 8192 })
  })

  it('treats a partial override as authoritative for the missing field', async () => {
    const { service } = makeService()
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', overrides: { context: 64000 } })
    expect(limits).toEqual({ context: 64000, output: null })
  })

  it('falls back to a learned limit for the same endpoint', async () => {
    const { service, learned } = makeService({ getCatalogLimit: CATALOG })
    learned.recordMaxTokensLimit('https://x/v1|m', 65536)
    const limits = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    // Learned thắng cả tier: field còn thiếu (context) rơi về default, không
    // xuống catalog — cùng semantics với override partial.
    expect(limits).toEqual({ context: 128000, output: 65536 })
  })

  it('matches a live /models tag against the bare model id', async () => {
    const { service } = makeService({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => [{ id: 'deepseek-v4-flash:0731', context: 131072, output: 65536 }]
    })
    // Lần đầu kick fetch nền (resolve trả về catalog); chờ fetch lấp cache.
    await service.resolveLimits({ provider: 'p', model: 'deepseek-v4-flash', baseUrl: 'https://x/v1', apiKey: 'sk' })
    await new Promise(r => setTimeout(r, 10))
    const limits = await service.resolveLimits({ provider: 'p', model: 'deepseek-v4-flash', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(limits).toEqual({ context: 131072, output: 65536 })
  })

  it('caches the live fetch per endpoint and refreshes after the ttl', async () => {
    let calls = 0
    const { service, clock } = makeService({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => { calls++; return [{ id: 'm', output: 65536 }] }
    })
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(calls).toBe(1)
    clock.now += 6 * 60_000
    await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(calls).toBe(2)
  })

  it('never blocks the first resolve on the network and lands the fetch for the next', async () => {
    let called = false
    const { service, clock } = makeService({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => { called = true; return [{ id: 'm', context: 64000 }] }
    })
    // Lần đầu: chưa có cache → resolve trả về catalog mà không await fetch.
    const first = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(first).toEqual({ context: 200000, output: MAX_OUTPUT_HARD_CAP })
    // Cho background fetch một tick để vào cache.
    await new Promise(r => setTimeout(r, 10))
    expect(called).toBe(true)
    clock.now += 1000
    const second = await service.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(second).toEqual({ context: 64000, output: null })
  })

  it('caps a catalog output claim but trusts learned/live values uncapped', async () => {
    const { service } = makeService({ getCatalogLimit: CATALOG })
    const catalog = await service.resolveLimits({ provider: 'p', model: 'm' })
    expect(catalog.output).toBe(MAX_OUTPUT_HARD_CAP) // 384000 → cap 131072

    const { service: live } = makeService({
      getCatalogLimit: CATALOG,
      fetchLiveModels: async () => [{ id: 'm', output: 1000000 }]
    })
    // Lần đầu kick fetch nền; chờ fetch lấp cache trước khi assert giá trị live.
    await live.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    await new Promise(r => setTimeout(r, 10))
    const liveLimits = await live.resolveLimits({ provider: 'p', model: 'm', baseUrl: 'https://x/v1', apiKey: 'sk' })
    expect(liveLimits.output).toBe(1000000) // live là sự thật của endpoint
  })

  it('falls back to the 128k default when nothing knows the model', async () => {
    const { service } = makeService()
    const limits = await service.resolveLimits({ provider: 'p', model: 'unknown-model' })
    expect(limits).toEqual({ context: 128000, output: null })
  })
})
