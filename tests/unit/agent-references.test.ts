import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { referenceHints } from '../../src/main/agent/references'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-ref-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('referenceHints', () => {
  it('does not inline file content; adds a read hint with the resolved path', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1')
    const out = referenceHints(dir, 'Look at @a.ts')
    expect(out).not.toContain('export const x = 1')
    expect(out).toContain('Read these referenced files with the read tool')
    expect(out).toContain(path.join(dir, 'a.ts'))
  })

  it('keeps the original text as the leading part', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'x')
    const out = referenceHints(dir, 'Look at @a.ts')
    expect(out.startsWith('Look at @a.ts')).toBe(true)
  })

  it('leaves text unchanged when no file matches', () => {
    const out = referenceHints(dir, 'Hello @nope.md there')
    expect(out).toBe('Hello @nope.md there')
  })

  it('handles a bare text without mentions', () => {
    expect(referenceHints(dir, 'plain prompt')).toBe('plain prompt')
  })

  it('resolves @./relative/path with dot prefix', () => {
    writeFileSync(path.join(dir, 'a.txt'), 'dot prefix content')
    const out = referenceHints(dir, 'read @./a.txt')
    expect(out).toContain(path.join(dir, 'a.txt'))
  })

  it('resolves @"path with space.txt"', () => {
    writeFileSync(path.join(dir, 'my file.txt'), 'spaced content')
    const out = referenceHints(dir, 'x @"my file.txt"')
    expect(out).toContain(path.join(dir, 'my file.txt'))
  })

  it('walks up to find AGENTS.md when cwd is a subdirectory', () => {
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Root instructions')
    const out = referenceHints(sub, 'Read @AGENTS.md before taking action.')
    expect(out).toContain(path.join(dir, 'AGENTS.md'))
  })

  it('still ignores mentions that resolve nowhere up the tree', () => {
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    const out = referenceHints(sub, 'Hello @nope.md there')
    expect(out).toBe('Hello @nope.md there')
  })
})
