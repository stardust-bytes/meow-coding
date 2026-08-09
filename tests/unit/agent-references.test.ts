import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expandReferences } from '../../src/main/agent/references'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-ref-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('expandReferences', () => {
  it('appends content of referenced files', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1')
    const out = expandReferences(dir, 'Look at @a.ts')
    expect(out).toContain('Referenced files')
    expect(out).toContain('export const x = 1')
    expect(out).toContain('@a.ts')
  })

  it('leaves text unchanged when no file matches', () => {
    const out = expandReferences(dir, 'Hello @nope.md there')
    expect(out).toBe('Hello @nope.md there')
  })

  it('handles a bare text without mentions', () => {
    expect(expandReferences(dir, 'plain prompt')).toBe('plain prompt')
  })

  it('expands @./relative/path with dot prefix', () => {
    writeFileSync(path.join(dir, 'a.txt'), 'dot prefix content')
    const out = expandReferences(dir, 'read @./a.txt')
    expect(out).toContain('dot prefix content')
  })

  it('expands @"path with space.txt"', () => {
    writeFileSync(path.join(dir, 'my file.txt'), 'spaced content')
    const out = expandReferences(dir, 'x @"my file.txt"')
    expect(out).toContain('spaced content')
  })

  it('walks up to find AGENTS.md when cwd is a subdirectory', () => {
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Root instructions')
    const out = expandReferences(sub, 'Read @AGENTS.md before taking action.')
    expect(out).toContain('# Root instructions')
  })

  it('still ignores mentions that resolve nowhere up the tree', () => {
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    const out = expandReferences(sub, 'Hello @nope.md there')
    expect(out).toBe('Hello @nope.md there')
  })

  it('reads AGENTS.md in full even past the regular cap', () => {
    writeFileSync(path.join(dir, 'AGENTS.md'), 'x'.repeat(60 * 1024) + 'THE-END')
    const out = expandReferences(dir, 'Read @AGENTS.md')
    expect(out).toContain('THE-END')
    expect(out).not.toContain('truncated')
  })

  it('caps regular referenced files at 50KB with a read-tool hint', () => {
    writeFileSync(path.join(dir, 'big.ts'), 'y'.repeat(60 * 1024))
    const out = expandReferences(dir, 'look at @big.ts')
    expect(out).toContain('use the read tool with offset')
    expect(out).not.toContain('y'.repeat(55 * 1024))
  })
})
