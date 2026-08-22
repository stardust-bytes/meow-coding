import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../../src/renderer/src/components/git/parseDiff'

describe('parseUnifiedDiff', () => {
  it('parses a simple hunk with add/del/ctx lines', () => {
    const raw = [
      'diff --git a/a.ts b/a.ts',
      'index 111..222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,4 @@',
      ' context',
      '-old line',
      '+new line',
      '+added line',
      ' last line'
    ].join('\n')
    const hunks = parseUnifiedDiff(raw)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 })
    expect(hunks[0].lines).toEqual([
      { type: 'ctx', oldLine: 1, newLine: 1, text: 'context' },
      { type: 'del', oldLine: 2, newLine: null, text: 'old line' },
      { type: 'add', oldLine: null, newLine: 2, text: 'new line' },
      { type: 'add', oldLine: null, newLine: 3, text: 'added line' },
      { type: 'ctx', oldLine: 3, newLine: 4, text: 'last line' }
    ])
  })

  it('handles multiple hunks with independent line counters', () => {
    const raw = [
      '@@ -1,1 +1,1 @@',
      ' a',
      '@@ -10,2 +10,2 @@',
      ' x',
      '-y',
      '+z'
    ].join('\n')
    const hunks = parseUnifiedDiff(raw)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines[0]).toMatchObject({ oldLine: 1, newLine: 1 })
    expect(hunks[1].lines).toEqual([
      { type: 'ctx', oldLine: 10, newLine: 10, text: 'x' },
      { type: 'del', oldLine: 11, newLine: null, text: 'y' },
      { type: 'add', oldLine: null, newLine: 11, text: 'z' }
    ])
  })

  it('keeps no-newline marker as meta line', () => {
    const raw = [
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file'
    ].join('\n')
    const hunks = parseUnifiedDiff(raw)
    expect(hunks[0].lines[1]).toEqual({ type: 'meta', oldLine: null, newLine: null, text: '\\ No newline at end of file' })
  })

  it('ignores content before the first hunk (file headers)', () => {
    const raw = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '+x'
    ].join('\n')
    const hunks = parseUnifiedDiff(raw)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines[0]).toMatchObject({ type: 'add', text: 'x' })
  })

  it('returns empty for empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('treats ---/+++ header lines after a hunk as context (defensive)', () => {
    // Rare: a file whose content starts with "---". Only matters inside a hunk.
    const raw = '@@ -1,2 +1,2 @@\n ---\n +++\n'
    const hunks = parseUnifiedDiff(raw)
    expect(hunks[0].lines.map(l => l.type)).toEqual(['ctx', 'ctx'])
  })
})
