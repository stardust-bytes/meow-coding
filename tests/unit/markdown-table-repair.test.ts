import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { normalizeMarkdownTables } from '../../src/renderer/src/components/chat/markdownTable'

marked.setOptions({ gfm: true, breaks: true })

describe('normalizeMarkdownTables', () => {
  it('pads a delimiter row that has fewer columns than the header (real LLM output)', () => {
    const text = '| File | Loại | Kích thước |\n|---|---|\n| a.exe | Installer | 104 MB |\n'
    expect((marked.parse(text, { async: false }) as string).includes('<table>')).toBe(false) // sanity: unpatched marked rejects this
    const fixed = normalizeMarkdownTables(text)
    expect(fixed).toContain('|---|---|---|')
    expect((marked.parse(fixed, { async: false }) as string)).toContain('<table>')
  })

  it('leaves an already-correct table untouched', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    expect(normalizeMarkdownTables(text)).toBe(text)
  })

  it('truncates a delimiter row that has more columns than the header', () => {
    const text = '| A | B |\n|---|---|---|\n| 1 | 2 |\n'
    const fixed = normalizeMarkdownTables(text)
    expect(fixed.split('\n')[1]).toBe('|---|---|')
  })

  it('leaves unrelated text with pipes and a following hr-like line alone when header has < 2 cells', () => {
    const text = 'no pipes here\n---\nmore text\n'
    expect(normalizeMarkdownTables(text)).toBe(text)
  })

  it('preserves alignment colons from the last delimiter cell when padding', () => {
    const text = '| A | B | C |\n|---|:---:|\n| 1 | 2 | 3 |\n'
    const fixed = normalizeMarkdownTables(text)
    expect(fixed.split('\n')[1]).toBe('|---|:---:|:---:|')
  })
})
