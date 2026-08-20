import { describe, expect, it } from 'vitest'
import { mapExtToLang, isHighlightable, highlightCode } from '../../src/renderer/src/components/chat/highlight'

describe('mapExtToLang', () => {
  it('maps common code extensions to canonical shiki languages', () => {
    expect(mapExtToLang('tsx')).toBe('tsx')
    expect(mapExtToLang('java')).toBe('java')
    expect(mapExtToLang('vue')).toBe('vue')
    expect(mapExtToLang('ts')).toBe('typescript')
    expect(mapExtToLang('js')).toBe('javascript')
    expect(mapExtToLang('py')).toBe('python')
    expect(mapExtToLang('sh')).toBe('shellscript')
  })
  it('normalizes case and leading dots', () => {
    expect(mapExtToLang('.TSX')).toBe('tsx')
    expect(mapExtToLang('Java')).toBe('java')
    expect(mapExtToLang('Vue')).toBe('vue')
  })
  it('returns undefined for unknown or empty extensions', () => {
    expect(mapExtToLang('xyz')).toBeUndefined()
    expect(mapExtToLang('')).toBeUndefined()
    expect(mapExtToLang('.')).toBeUndefined()
  })
})

describe('isHighlightable', () => {
  it('is true for code extensions and false for others', () => {
    expect(isHighlightable('tsx')).toBe(true)
    expect(isHighlightable('java')).toBe(true)
    expect(isHighlightable('vue')).toBe(true)
    expect(isHighlightable('txt')).toBe(false)
    expect(isHighlightable('xyz')).toBe(false)
  })
})

describe('highlightCode fallback', () => {
  it('returns null for an unknown grammar without touching the highlighter', async () => {
    expect(await highlightCode('hello', 'xyz')).toBeNull()
  })
})
