import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadMemoryIndex,
  memoryDir,
  memoryRulesText,
  parseMemoryFile,
  isMemoryPath,
  MEMORY_INDEX_MAX_LINES
} from '../../src/main/agent/memory'

describe('memoryDir', () => {
  it('is <cwd>/.meow/memory', () => {
    expect(memoryDir('/proj')).toBe(path.join('/proj', '.meow', 'memory'))
  })
})

describe('loadMemoryIndex', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-mem-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns an empty index when MEMORY.md is missing', () => {
    expect(loadMemoryIndex(dir)).toEqual({
      path: path.join(dir, '.meow', 'memory', 'MEMORY.md'),
      lines: [],
      truncated: false
    })
  })

  it('loads index lines from MEMORY.md', () => {
    mkdirSync(path.join(dir, '.meow', 'memory'), { recursive: true })
    writeFileSync(path.join(dir, '.meow', 'memory', 'MEMORY.md'), '- [A](a.md) — a hook\n- [B](b.md) — b hook\n')
    const idx = loadMemoryIndex(dir)
    expect(idx.lines).toEqual(['- [A](a.md) — a hook', '- [B](b.md) — b hook'])
    expect(idx.truncated).toBe(false)
  })

  it('truncates an over-long index to 200 lines and flags it', () => {
    mkdirSync(path.join(dir, '.meow', 'memory'), { recursive: true })
    const lines = Array.from({ length: MEMORY_INDEX_MAX_LINES + 25 }, (_, i) => `- [f${i}](f${i}.md) — x`)
    writeFileSync(path.join(dir, '.meow', 'memory', 'MEMORY.md'), lines.join('\n') + '\n')
    const idx = loadMemoryIndex(dir)
    expect(idx.lines).toHaveLength(MEMORY_INDEX_MAX_LINES)
    expect(idx.truncated).toBe(true)
  })

})

describe('parseMemoryFile', () => {
  it('parses name/description/metadata.type from frontmatter', () => {
    const content = `---
name: user-likes-pnpm
description: user prefers pnpm
metadata:
  type: user
---
The fact body.`
    expect(parseMemoryFile(content)).toEqual({
      ok: true,
      name: 'user-likes-pnpm',
      description: 'user prefers pnpm',
      type: 'user'
    })
  })

  it('rejects content without a name or without frontmatter', () => {
    expect(parseMemoryFile('no frontmatter here')).toEqual({ ok: false })
    expect(parseMemoryFile('---\ndescription: only desc\n---')).toEqual({ ok: false })
  })
})

describe('isMemoryPath', () => {
  it('is true for files inside the memory dir and false outside', () => {
    const dir = memoryDir('/proj')
    expect(isMemoryPath(dir, path.join(dir, 'fact.md'))).toBe(true)
    expect(isMemoryPath(dir, '/proj/src/a.ts')).toBe(false)
  })
})

describe('memoryRulesText', () => {
  it('names the memory directory and the index file', () => {
    const text = memoryRulesText('/proj')
    expect(text).toContain(path.join('/proj', '.meow', 'memory'))
    expect(text).toContain('MEMORY.md')
    expect(text).toContain('[[name]]')
  })
})
