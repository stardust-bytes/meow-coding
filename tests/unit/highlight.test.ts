import { describe, expect, it } from 'vitest'
import { mapExtToLang, isHighlightable, highlightCode, preloadLanguage } from '../../src/renderer/src/components/chat/highlight'

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

describe('preloadLanguage', () => {
  it('resolves without error for a known extension', async () => {
    await expect(preloadLanguage('tsx')).resolves.toBeUndefined()
  })
  it('no-ops for unknown extensions', async () => {
    await expect(preloadLanguage('xyz')).resolves.toBeUndefined()
  })
  it('makes the first highlight fast after preload', async () => {
    const code = `const x: number = 42\nconsole.log(x)`
    const t0 = performance.now()
    await preloadLanguage('tsx')
    const t1 = performance.now()
    const html = await highlightCode(code, 'tsx')
    const t2 = performance.now()
    expect(html).not.toBeNull()
    // First real highlight after a warm preload should be well under 100ms
    // (cold path is ~200ms+ for engine init + grammar compile).
    expect(t2 - t1).toBeLessThan(100)
    console.log(`[test] preload=${(t1 - t0).toFixed(0)}ms highlightAfterPreload=${(t2 - t1).toFixed(0)}ms`)
  }, 30000)
})
