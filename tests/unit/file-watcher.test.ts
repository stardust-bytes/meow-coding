import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileWatcher } from '../../src/main/file-watcher'

describe('FileWatcher', () => {
  let dir: string
  let watcher: FileWatcher | null = null

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-watch-'))
  })

  afterEach(() => {
    watcher?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports changed text files and ignores node_modules/.git', async () => {
    mkdirSync(path.join(dir, 'src'), { recursive: true })
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
    mkdirSync(path.join(dir, '.git'), { recursive: true })
    const received: string[][] = []
    watcher = new FileWatcher(dir, (files) => received.push(files))
    watcher.start()

    writeFileSync(path.join(dir, 'src', 'a.ts'), 'x')
    writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'x')
    writeFileSync(path.join(dir, '.git', 'config'), 'x')
    writeFileSync(path.join(dir, 'note.md'), 'hi')

    await new Promise(r => setTimeout(r, 1200))

    const all = received.flat()
    expect(all).toContain('src/a.ts')
    expect(all).toContain('note.md')
    expect(all.some(f => f.includes('node_modules'))).toBe(false)
    expect(all.some(f => f.startsWith('.git/'))).toBe(false)
  })

  it('ignores non-text extensions', async () => {
    const received: string[][] = []
    watcher = new FileWatcher(dir, (files) => received.push(files))
    watcher.start()
    writeFileSync(path.join(dir, 'image.png'), 'x')
    await new Promise(r => setTimeout(r, 800))
    expect(received.flat()).toHaveLength(0)
  })

  it('hasContentChanged is false for untouched files and true for real edits', async () => {
    writeFileSync(path.join(dir, 'a.md'), 'one')
    watcher = new FileWatcher(dir, () => {})
    watcher.start()
    // Wait for the background baseline walk to finish.
    await new Promise(r => setTimeout(r, 800))

    // No-op event for an unchanged file (simulates read/touch noise).
    expect(watcher.hasContentChanged('a.md')).toBe(false)

    // A real edit moves mtime/size → detected.
    writeFileSync(path.join(dir, 'a.md'), 'one two')
    expect(watcher.hasContentChanged('a.md')).toBe(true)

    // Baseline was refreshed by the previous call → same stat, no change.
    expect(watcher.hasContentChanged('a.md')).toBe(false)

    // A brand-new file is detected.
    writeFileSync(path.join(dir, 'b.md'), 'new')
    expect(watcher.hasContentChanged('b.md')).toBe(true)

    // A deleted file is not an artifact.
    rmSync(path.join(dir, 'b.md'))
    expect(watcher.hasContentChanged('b.md')).toBe(false)
  })
})
