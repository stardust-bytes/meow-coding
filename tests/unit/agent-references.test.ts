import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
})
