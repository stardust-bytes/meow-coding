import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

  it('keeps embedded quotes intact on windows (cd to a temp dir)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cd-'))
    try {
      if (process.platform === 'win32') {
        const c = buildShellCommand(`cd /d "${dir}" && echo OK_CD`)
        expect(c.args[3]).toBe(`"cd /d "${dir}" && echo OK_CD"`)
      }
      const cmd = process.platform === 'win32'
        ? `cd /d "${dir}" && echo OK_CD`
        : `cd "${dir}" && echo OK_CD`
      const r = await bashTool.run({ command: cmd }, ctx)
      expect(r.output).toContain('OK_CD')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  afterAll(cleanup)
})
