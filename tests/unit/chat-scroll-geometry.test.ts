import { describe, expect, it } from 'vitest'
import {
  CHAT_BOTTOM_FOLLOW_ZONE,
  CHAT_TURN_TOP_INSET,
  anchorScrollTop,
  followScrollDelta,
  isInBottomFollowZone,
  nextChatScrollMode,
  tailSpacerHeight
} from '../../src/renderer/src/components/chat/chat-scroll-geometry'

describe('chat scroll geometry', () => {
  it('positions the active user row at the 20px top inset', () => {
    expect(anchorScrollTop({
      currentScrollTop: 600,
      feedTop: 100,
      rowTop: 360,
      scrollHeight: 1800,
      clientHeight: 700
    })).toBe(840)
    expect(CHAT_TURN_TOP_INSET).toBe(20)
  })

  it('clamps anchor targets to the valid scroll range', () => {
    expect(anchorScrollTop({ currentScrollTop: 0, feedTop: 100, rowTop: 80, scrollHeight: 400, clientHeight: 300 })).toBe(0)
    expect(anchorScrollTop({ currentScrollTop: 900, feedTop: 0, rowTop: 500, scrollHeight: 1000, clientHeight: 300 })).toBe(700)
  })

  it('uses an inclusive 80px bottom follow zone', () => {
    expect(isInBottomFollowZone({ scrollHeight: 1000, scrollTop: 620, clientHeight: 300 })).toBe(true)
    expect(isInBottomFollowZone({ scrollHeight: 1000, scrollTop: 619, clientHeight: 300 })).toBe(false)
    expect(CHAT_BOTTOM_FOLLOW_ZONE).toBe(80)
  })

  it('shrinks turn tail space as rendered output grows', () => {
    expect(tailSpacerHeight({ clientHeight: 600, anchorTop: 20, latestBottom: 220 })).toBe(380)
    expect(tailSpacerHeight({ clientHeight: 600, anchorTop: 20, latestBottom: 760 })).toBe(0)
  })

  it('does not move until current turn content crosses the lower reading boundary', () => {
    expect(followScrollDelta({ feedBottom: 700, latestBottom: 680 })).toBe(0)
    expect(followScrollDelta({ feedBottom: 700, latestBottom: 701 })).toBe(15)
  })

  it('transitions only through explicit scroll intent', () => {
    expect(nextChatScrollMode('following', 'start-turn')).toBe('anchoring-turn')
    expect(nextChatScrollMode('anchoring-turn', 'anchor-applied')).toBe('following')
    expect(nextChatScrollMode('following', 'user-away')).toBe('manual')
    expect(nextChatScrollMode('manual', 'content-updated')).toBe('manual')
    expect(nextChatScrollMode('manual', 'user-bottom')).toBe('following')
    expect(nextChatScrollMode('manual', 'jump-end')).toBe('following')
    expect(nextChatScrollMode('manual', 'session-load')).toBe('following')
  })
})
