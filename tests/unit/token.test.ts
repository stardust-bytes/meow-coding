import { describe, expect, it } from 'vitest'
import { estimateTokens, estimateUsage } from '../../src/main/agent/token'

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars like opencode', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello world')).toBe(Math.round(11 / 4))
    expect(estimateTokens('x'.repeat(1000))).toBe(250)
  })

  it('never returns a negative count', () => {
    expect(estimateTokens('')).toBeGreaterThanOrEqual(0)
  })
})

describe('estimateUsage', () => {
  it('serializes structured payloads before estimating', () => {
    const payload = { role: 'user', content: 'a'.repeat(800) }
    expect(estimateUsage(payload)).toBe(estimateTokens(JSON.stringify(payload)))
  })
})
