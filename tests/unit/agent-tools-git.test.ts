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

afterEach(() => rmSync(dir, { recursive: true, force: true }))

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
})
