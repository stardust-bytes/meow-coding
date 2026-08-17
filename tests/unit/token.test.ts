import { describe, expect, it } from 'vitest'
import { estimateTokens, estimateUsage } from '../../src/main/agent/token'

describe('estimateTokens', () => {
  it('estimates ~1 token per 3.5 chars like dense JSON/code transcripts', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello world')).toBe(Math.round(11 / 3.5))
    expect(estimateTokens('x'.repeat(1000))).toBe(Math.round(1000 / 3.5))
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
