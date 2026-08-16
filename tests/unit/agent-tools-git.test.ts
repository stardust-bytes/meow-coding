import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitTool } from '../../src/main/agent/tools/git'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir: string
let ctx: ToolContext

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-git-tool-'))
  ctx = { cwd: dir, ask: async () => null }
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    // On Windows, after aborting git-spawned child processes, file locks
    // may persist briefly. These will be cleaned up by the OS eventually.
    // We allow EBUSY errors to pass silently rather than failing the test.
    if ((e as NodeJS.ErrnoException).code !== 'EBUSY') {
      throw e
    }
  }
})

describe('git tool', () => {
  it('reports a clean status', async () => {
    const r = await gitTool.run({ args: 'status --porcelain' }, ctx)
    expect(r.output).toBe('(no output)')
  })

  it('shows a diff after modification', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    const r = await gitTool.run({ args: 'diff' }, ctx)
    expect(r.output).toContain('-one')
    expect(r.output).toContain('+two')
  })

  it('shows recent log', async () => {
    const r = await gitTool.run({ args: 'log --oneline -1' }, ctx)
    expect(r.output).toContain('init')
  })

  it('returns an error for a failing git command', async () => {
    const r = await gitTool.run({ args: 'nosuchcommand' }, ctx)
    expect(r.error).toMatch(/failed/)
  })

  it('errors on missing args', async () => {
    const r = await gitTool.run({}, ctx)
    expect(r.error).toMatch(/missing/)
  })

  it('does not ENOENT when the cwd is missing', async () => {
    const missing = path.join(tmpdir(), 'meow-git-missing-' + Date.now())
    const r = await gitTool.run({ args: 'status' }, { cwd: missing, ask: async () => null })
    expect(r.error).toBeTruthy()
    expect(r.error).not.toMatch(/ENOENT/)
  })

  it('errors immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const r = await gitTool.run({ args: 'status' }, { ...ctx, signal: controller.signal })
    expect(r.error).toMatch(/aborted/i)
  })

  it('kills a running git command when aborted mid-run', async () => {
    execFileSync('git', ['config', 'alias.sleep', process.platform === 'win32'
      ? '!ping -n 30 127.0.0.1'
      : '!sleep 30'], { cwd: dir })
    const controller = new AbortController()
    const start = Date.now()
    const run = gitTool.run({ args: 'sleep' }, { ...ctx, signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    const r = await run
    const elapsed = Date.now() - start
    expect(r.error).toMatch(/aborted/i)
    expect(elapsed).toBeLessThan(5000)
  }, 20000)

  it('still runs normally when an unaborted signal is provided', async () => {
    const controller = new AbortController()
    const r = await gitTool.run({ args: 'status --porcelain' }, { ...ctx, signal: controller.signal })
    expect(r.output).toBe('(no output)')
  })
})
