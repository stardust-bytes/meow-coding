import { describe, expect, it } from 'vitest'
import {
  CHATGPT_WEB_PROVIDER_ID, CHATGPT_WEB_EFFORT_LEVELS, getChatGptWebModelRefs, resolveChatGptWebEffort
} from '../../src/main/chatgpt-web/model-catalog'

describe('chatgpt-web model catalog', () => {
  it('defines exactly 5 effort levels with unique ids and increasing uiEffortIndex', () => {
    expect(CHATGPT_WEB_EFFORT_LEVELS).toHaveLength(5)
    const ids = CHATGPT_WEB_EFFORT_LEVELS.map(e => e.id)
    expect(new Set(ids).size).toBe(5)
    expect(CHATGPT_WEB_EFFORT_LEVELS.map(e => e.uiEffortIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('returns one ModelRef per effort level under the chatgpt-web provider', () => {
    const refs = getChatGptWebModelRefs()
    expect(refs).toHaveLength(5)
    expect(refs.every(r => r.provider === CHATGPT_WEB_PROVIDER_ID)).toBe(true)
    expect(refs.map(r => r.model).sort()).toEqual(['high', 'light', 'medium', 'pro', 'xhigh'].sort())
  })

  it('resolves a known model id to its effort level', () => {
    const effort = resolveChatGptWebEffort('high')
    expect(effort?.uiEffortIndex).toBe(2)
  })

  it('returns null for an unknown model id', () => {
    expect(resolveChatGptWebEffort('nope')).toBeNull()
  })
})
