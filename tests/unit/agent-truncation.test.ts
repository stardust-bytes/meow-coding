import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TruncationStore } from '../../src/main/agent/truncation'

describe('TruncationStore', () => {
  let dir: string
  let store: TruncationStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-trunc-'))
    store = new TruncationStore(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns the text unchanged when it fits within maxBytes', () => {
    const text = 'small output'
    expect(store.truncate('a1', 'tool1', text, { maxBytes: 1000 })).toBe(text)
  })

  it('writes the full output to a file and returns a head/tail preview', () => {
    const text = 'x'.repeat(100000)
    const preview = store.truncate('a1', 'bash-1', text, { maxBytes: 51200, headBytes: 100, tailBytes: 100 })
    expect(preview).toContain('[Output truncated to 100000 chars; full output at')
    expect(preview.length).toBeLessThan(500)
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(existsSync(path.join(dir, files[0]))).toBe(true)
  })

  it('falls back to a plain slice when the file cannot be written', () => {
    // A path whose parent is an existing file, so mkdirSync fails.
    const blocker = path.join(dir, 'blocker.txt')
    writeFileSync(blocker, 'block')
    const s = new TruncationStore(path.join(blocker, 'sub'))
    const text = 'y'.repeat(1000)
    const preview = s.truncate('a1', 't', text, { maxBytes: 100, headBytes: 20, tailBytes: 20 })
    expect(preview).toContain('[truncated]')
  })

  it('cleanup removes files older than the retention window', () => {
    writeFileSync(path.join(dir, 'old.txt'), 'old')
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    const { utimesSync } = require('node:fs') as typeof import('node:fs')
    utimesSync(path.join(dir, 'old.txt'), old, old)
    store.cleanup(7)
    expect(existsSync(path.join(dir, 'old.txt'))).toBe(false)
  })

  it('exists reports whether a file was written for a tool', () => {
    store.truncate('a1', 'bash-1', 'z'.repeat(1000), { maxBytes: 100 })
    expect(store.exists('a1', 'bash-1')).toBe(true)
  })
})
