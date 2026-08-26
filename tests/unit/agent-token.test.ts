import { describe, expect, it } from 'vitest'
import { estimateTokens, estimateUsage } from '../../src/main/agent/token'
import type { TranscriptItem } from '../../src/main/agent/message'

const bigImage = 'data:image/png;base64,' + 'A'.repeat(1_000_000)

describe('estimateTokens', () => {
  it('counts plain text by length', () => {
    expect(estimateTokens('x'.repeat(3500))).toBe(1000)
  })
})

describe('estimateUsage', () => {
  it('counts an image part as a flat cost, not its base64 length', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image', image: bigImage }] }
    ]
    const tokens = estimateUsage(messages)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(5000)
  })

  it('counts an image attached to a transcript message the same way', () => {
    const items: TranscriptItem[] = [
      {
        kind: 'message',
        message: {
          id: 'm1',
          role: 'user',
          text: 'look at this',
          images: [{ dataUrl: bigImage }],
          createdAt: 1
        }
      }
    ]
    expect(estimateUsage(items)).toBeLessThan(5000)
  })

  it('still counts ordinary text content by length', () => {
    const tokens = estimateUsage([{ role: 'user', content: 'y'.repeat(3500) }])
    expect(tokens).toBeGreaterThan(990)
    expect(tokens).toBeLessThan(1030)
  })
})
