import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { bashTool, buildShellCommand } from '../../src/main/agent/tools/bash'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir = mkdtempSync(path.join(tmpdir(), 'meow-bash-'))
const ctx: ToolContext = { cwd: dir, ask: async () => null }

function cleanup() {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

describe('bash tool', () => {
  it('runs a command and captures output', async () => {
    const r = await bashTool.run({ command: process.platform === 'win32' ? 'echo MEOW_OK' : 'echo MEOW_OK' }, ctx)
    expect(r.output).toContain('MEOW_OK')
  }, 20000)

  it('reports a nonzero exit as an error with output', async () => {
    const r = await bashTool.run(
      { command: process.platform === 'win32' ? 'echo hi && exit 3' : 'echo hi; exit 3' },
      ctx
    )
    expect(r.error).toMatch(/exit code 3/)
    expect(r.error).toContain('hi')
  }, 20000)

  it('times out and kills the process tree', async () => {
    const cmd = process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1'
      : 'sleep 30'
    const r = await bashTool.run({ command: cmd, timeoutMs: 500 }, ctx)
    expect(r.error).toMatch(/timeout/)
  }, 20000)

  it('returns an error for a missing command', async () => {
    const r = await bashTool.run(
      { command: process.platform === 'win32' ? 'definitely-not-a-command-xyz' : 'definitely-not-a-command-xyz' },
      ctx
    )
    expect(r.error ?? r.output).toBeTruthy()
  }, 20000)

  it('keeps embedded quotes intact (runs in the working directory)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cd-'))
    try {
      if (process.platform === 'win32') {
        const c = buildShellCommand('echo OK_CD', dir)
        expect(c.command.toLowerCase()).toMatch(/bash\.exe$/)
        expect(c.args[3]).toBe(dir)
        expect(c.verbatim).toBe(false)
      }
      const r = await bashTool.run({ command: 'echo "OK_CD"' }, ctx)
      expect(r.output).toContain('OK_CD')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  it('runs unix commands through git bash on windows', async () => {
    if (process.platform !== 'win32') return
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cd-'))
    try {
      const r = await bashTool.run({ command: `ls "${dir}" > /dev/null && echo LS_OK` }, { cwd: dir, ask: async () => null })
      expect(r.output).toContain('LS_OK')
      const pwd = await bashTool.run({ command: 'pwd' }, { cwd: dir, ask: async () => null })
      expect(pwd.output).toMatch(/meow-cd-|\\meow-cd-/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  it('falls back to an existing cwd when the project dir is missing', async () => {
    const missing = path.join(tmpdir(), 'meow-missing-dir-' + Date.now())
    const r = await bashTool.run(
      { command: process.platform === 'win32' ? 'echo OK_FALLBACK' : 'echo OK_FALLBACK' },
      { cwd: missing, ask: async () => null }
    )
    expect(r.output).toContain('OK_FALLBACK')
    expect(r.output).toMatch(/khong ton tai|fallback/i)
  }, 20000)

  it('runs the bundled superpowers SDD scripts (git bash)', async () => {
    if (process.platform !== 'win32') return
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-sdd-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
      mkdirSync(path.join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
      writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', 'test.md'),
        '# Plan\n\n### Task 1: first\n\nstep a\n\n### Task 2: second\n\nstep b\n')
      const skillDir = path.join('D:', 'GitHub', 'meow-coding', 'resources', 'skills', 'subagent-driven-development')
      const sddWorkspace = path.join(skillDir, 'scripts', 'sdd-workspace')
      const taskBrief = path.join(skillDir, 'scripts', 'task-brief')
      const plan = 'docs/superpowers/plans/test.md'
      const ctx2: ToolContext = { cwd: dir, ask: async () => null }

      const ws = await bashTool.run({ command: `bash "${sddWorkspace}" "${plan}"` }, ctx2)
      expect(ws.error ?? '').toBe('')
      expect(ws.output).toMatch(/\.superpowers[/\\]sdd[/\\]test$/)

      const brief = await bashTool.run({ command: `bash "${taskBrief}" "${plan}" 1` }, ctx2)
      expect(brief.error ?? '').toBe('')
      expect(existsSync(path.join(dir, '.superpowers', 'sdd', 'test', 'task-1-brief.md'))).toBe(true)
      expect(brief.output).toContain('wrote')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)

  afterAll(cleanup)
})
