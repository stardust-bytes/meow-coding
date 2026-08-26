import { describe, expect, it } from 'vitest'
import {
  parseLiveModelsInfo, matchModel, classifyContextOverflowError, parseContextLimitFromError
} from '../../src/main/agent/limits'

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
      'Please reduce the length of the messages or completion'
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
