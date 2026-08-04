import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitStatusService } from '../../src/main/git-status-service'

describe('GitStatusService.parse', () => {
  const svc = new GitStatusService()

  it('parses branch and dirty count from porcelain v2 output', () => {
    const out = [
      '# branch.oid abc123',
      '# branch.head main',
      '1 M 100644 123 456 789 file.ts',
      '? untracked.txt'
    ].join('\n') + '\n'
    expect(svc.parse(out)).toEqual({ branch: 'main', dirtyCount: 2 })
  })

  it('ignores branch header lines when counting dirty files', () => {
    const out = '# branch.oid xyz\n# branch.head feat/abc\n'
    expect(svc.parse(out)).toEqual({ branch: 'feat/abc', dirtyCount: 0 })
  })

  it('handles detached HEAD as null branch', () => {
    const out = '# branch.oid abc\n# branch.head (detached)\n'
    expect(svc.parse(out)).toEqual({ branch: null, dirtyCount: 0 })
  })
})

describe('GitStatusService.get', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-git-'))
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null when not a git repo', async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'meow-git-nr-'))
    try {
      const result = await new GitStatusService().get(notRepo)
      expect(result).toBeNull()
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })

  it('reports branch and a dirty file', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hi')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
    writeFileSync(path.join(dir, 'a.txt'), 'changed')
    const result = await new GitStatusService().get(dir)
    expect(result).not.toBeNull()
    expect(result?.branch).toBe('main')
    expect(result!.dirtyCount).toBe(1)
  })
})
