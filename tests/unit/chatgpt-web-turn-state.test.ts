import { describe, expect, it } from 'vitest'
import {
  ChatGptWebTabLimiter, isChatGptWebTurnComplete, isChatGptWebRateLimitDialog
} from '../../src/main/chatgpt-web/turn-state'

describe('ChatGptWebTabLimiter', () => {
  it('allows up to `max` concurrent holders', async () => {
    const limiter = new ChatGptWebTabLimiter(2)
    const release1 = await limiter.acquire()
    const release2 = await limiter.acquire()
    expect(limiter.active).toBe(2)
    release1()
    release2()
  })

  it('queues a third acquire until a slot is released', async () => {
    const limiter = new ChatGptWebTabLimiter(1)
    const release1 = await limiter.acquire()
    let acquired = false
    const p = limiter.acquire().then(release => { acquired = true; release() })
    await new Promise(r => setTimeout(r, 10))
    expect(acquired).toBe(false)
    release1()
    await p
    expect(acquired).toBe(true)
  })
})

describe('isChatGptWebTurnComplete', () => {
  it('is false while the stop button is visible', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: true, hasCopyButton: false, textLength: 10 })).toBe(false)
  })

  it('is false when there is no text yet', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: false, hasCopyButton: true, textLength: 0 })).toBe(false)
  })

  it('is true once the stop button is gone, the copy button is visible, and there is text', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: false, hasCopyButton: true, textLength: 42 })).toBe(true)
  })
})

describe('isChatGptWebRateLimitDialog', () => {
  it('matches known ChatGPT rate-limit phrasing', () => {
    expect(isChatGptWebRateLimitDialog('You are sending messages too quickly. Please slow down.')).toBe(true)
    expect(isChatGptWebRateLimitDialog('Too many requests, try again later.')).toBe(true)
  })

  it('does not match unrelated dialog text', () => {
    expect(isChatGptWebRateLimitDialog('Allow ChatGPT to use the connector?')).toBe(false)
  })
})
