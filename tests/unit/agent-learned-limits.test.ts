import { describe, expect, it } from 'vitest'
import { LearnedLimitsStore, normalizeLearnedKey } from '../../src/main/agent/learned-limits'
import type { LearnedLimitEntry } from '../../src/main/agent/learned-limits'
import type { JsonStore } from '../../src/main/json-store'

function makeStore(initial: LearnedLimitEntry[] = []) {
  const data: LearnedLimitEntry[] = [...initial]
  const json: JsonStore<LearnedLimitEntry> = {
    load: () => data,
    save: (next) => data.splice(0, data.length, ...next)
  }
  return { store: new LearnedLimitsStore(json), data }
}

describe('normalizeLearnedKey', () => {
  it('keys by baseUrl|model, tolerating a missing base url', () => {
    expect(normalizeLearnedKey('https://ollama.com/v1', 'deepseek-v4-flash')).toBe('https://ollama.com/v1|deepseek-v4-flash')
    expect(normalizeLearnedKey(undefined, 'deepseek-v4-flash')).toBe('|deepseek-v4-flash')
  })
})

describe('LearnedLimitsStore', () => {
  it('loads existing entries and serves them by key', () => {
    const { store } = makeStore([{ key: 'a|m', context: 64000, output: 65536 }])
    expect(store.get('a|m')).toEqual({ key: 'a|m', context: 64000, output: 65536 })
    expect(store.get('nope')).toBeUndefined()
  })

  it('records a max_tokens limit and persists it', () => {
    const { store, data } = makeStore()
    store.recordMaxTokensLimit('a|m', 65536)
    expect(store.get('a|m')?.output).toBe(65536)
    expect(data).toEqual([{ key: 'a|m', output: 65536 }])
  })

  it('never raises an already-learned output cap', () => {
    const { store } = makeStore([{ key: 'a|m', output: 65536 }])
    store.recordMaxTokensLimit('a|m', 131072)
    expect(store.get('a|m')?.output).toBe(65536)
  })

  it('records a context ceiling only when it shrinks', () => {
    const { store } = makeStore([{ key: 'a|m', context: 200000 }])
    store.recordContextOverflow('a|m', 50000)
    expect(store.get('a|m')?.context).toBe(50000)
    store.recordContextOverflow('a|m', 80000) // larger ceiling is no tighter
    expect(store.get('a|m')?.context).toBe(50000)
  })

  it('merges a new limit with the existing entry', () => {
    const { store } = makeStore([{ key: 'a|m', output: 65536 }])
    store.recordContextOverflow('a|m', 50000)
    expect(store.get('a|m')).toEqual({ key: 'a|m', output: 65536, context: 50000 })
  })
})
