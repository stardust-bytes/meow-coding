import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectShell, gitFreshnessReminder, snapshotEnvironment } from '../../src/main/agent/env'

describe('snapshotEnvironment', () => {
  it('reports platform, shell, cwd and date in a git repo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-env-'))
    try {
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
      writeFileSync(path.join(dir, 'a.txt'), 'hi')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
      writeFileSync(path.join(dir, 'a.txt'), 'changed')
      const env = await snapshotEnvironment(dir)
      expect(env.platform).toBe(process.platform)
      expect(env.shell).toBeTruthy()
      expect(env.cwd).toBe(dir)
      expect(env.date).toBeTruthy()
      expect(env.git).toEqual({ branch: 'main', dirtyCount: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('returns git null when not a repository', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-env-nr-'))
    try {
      const env = await snapshotEnvironment(dir)
      expect(env.git).toBeNull()
      expect(env.cwd).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('gitFreshnessReminder', () => {
  it('returns an empty string outside a repo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-fresh-nr-'))
    try {
      expect(await gitFreshnessReminder(dir)).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders a reminder with branch and dirty count in a repo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-fresh-'))
    try {
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
      writeFileSync(path.join(dir, 'a.txt'), 'x')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
      writeFileSync(path.join(dir, 'a.txt'), 'changed')
      const r = await gitFreshnessReminder(dir)
      expect(r).toContain('<system-reminder>')
      expect(r).toContain('main')
      expect(r).toContain('1 dirty file')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('detectShell', () => {
  it('returns a non-empty shell string', () => {
    expect(detectShell()).toBeTruthy()
  })
})
