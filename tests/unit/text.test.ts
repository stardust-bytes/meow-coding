import { describe, expect, it } from 'vitest'
import { appendStreamDelta } from '../../src/shared/text'

describe('appendStreamDelta', () => {
  it('appends disjoint deltas unchanged', () => {
    let buf = appendStreamDelta('', 'Tất')
    buf = appendStreamDelta(buf, ' nhiên')
    buf = appendStreamDelta(buf, '!!')
    expect(buf).toBe('Tất nhiên!!')
  })

  it('strips an overlapping suffix from the incoming delta', () => {
    let buf = appendStreamDelta('', 'Tất')
    buf = appendStreamDelta(buf, 'ất nhi')
    buf = appendStreamDelta(buf, 'nhiên!!')
    buf = appendStreamDelta(buf, 'ên!! ')
    buf = appendStreamDelta(buf, '!! Bạn')
    expect(buf).toBe('Tất nhiên!! Bạn')
  })

  it('handles full duplicate delivery (exact same delta twice)', () => {
    let buf = appendStreamDelta('', 'hello')
    buf = appendStreamDelta(buf, 'hello')
    expect(buf).toBe('hello')
  })

  it('handles empty buffer and empty delta', () => {
    expect(appendStreamDelta('', 'x')).toBe('x')
    expect(appendStreamDelta('abc', '')).toBe('abc')
  })
})
