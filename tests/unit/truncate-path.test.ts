import { describe, expect, it } from 'vitest'
import { truncatePath } from '../../src/renderer/src/components/truncatePath'

// Fake monospace metric: 7px per char keeps the arithmetic easy.
const measure = (s: string) => s.length * 7

describe('truncatePath', () => {
  it('keeps short paths as-is', () => {
    expect(truncatePath('src/a.ts', measure, 100)).toBe('src/a.ts')
  })

  it('keeps the full path when it fits exactly', () => {
    expect(truncatePath('src/a.ts', measure, 63)).toBe('src/a.ts')
  })

  it('prefixes the ellipsis and keeps the basename when it fits', () => {
    const path = 'src/components/chat/FileViewer.tsx'
    // prefix + basename = 3 + 14 chars → 119px; full path is 35 chars → 245px
    expect(truncatePath(path, measure, 130)).toBe('…/FileViewer.tsx')
  })

  it('prefers the last / separator and handles Windows backslashes', () => {
    const path = 'docs\\features\\readme.md'
    expect(truncatePath(path, measure, 100)).toBe('…/readme.md')
  })

  it('trims the basename when even it overflows', () => {
    const path = 'src/a.ts'
    // '…/a.ts' = 6 chars → 42px > 40; '…/a.t' = 5 chars → 35px fits
    expect(truncatePath(path, measure, 40)).toBe('…/a.t')
  })

  it('never returns a longer string than the prefix alone', () => {
    const path = 'x.ts'
    expect(truncatePath(path, measure, 5)).toBe('…/')
  })
})
