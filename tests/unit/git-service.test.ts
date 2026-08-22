import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitService } from '../../src/main/git-service'

describe('GitService.parse', () => {
  it('parseBranches marks local/remote/current', () => {
    const out = 'refs/heads/main\t*\nrefs/heads/feat/x\t\nrefs/remotes/origin/main\t\nrefs/remotes/origin/dev\t\n'
    const branches = GitService.parseBranches(out)
    expect(branches).toEqual([
      { name: 'main', isRemote: false, isCurrent: true },
      { name: 'feat/x', isRemote: false, isCurrent: false },
      { name: 'origin/main', isRemote: true, isCurrent: false },
      { name: 'origin/dev', isRemote: true, isCurrent: false }
    ])
  })

  it('parseStatus parses staged, unstaged and untracked with spaces in path', () => {
    const out = [
      '## feature/abc...origin/feature/abc',
      'M  staged.txt',
      ' M unstaged.txt',
      'MM both.txt',
      'A  added.txt',
      'D  deleted.txt',
      'R  old.txt -> new.txt',
      '?? untracked dir/file with spaces.txt'
    ].join('\n') + '\n'
    const st = GitService.parseStatus(out)
    expect(st.branch).toBe('feature/abc')
    const byPath = (p: string) => st.files.find(f => f.path === p)!
    expect(byPath('staged.txt')).toMatchObject({ status: 'modified', staged: true, unstaged: false })
    expect(byPath('unstaged.txt')).toMatchObject({ status: 'modified', staged: false, unstaged: true })
    expect(byPath('both.txt')).toMatchObject({ staged: true, unstaged: true })
    expect(byPath('added.txt')).toMatchObject({ status: 'added' })
    expect(byPath('deleted.txt')).toMatchObject({ status: 'deleted' })
    expect(byPath('new.txt')).toMatchObject({ status: 'renamed' })
    expect(byPath('untracked dir/file with spaces.txt')).toMatchObject({
      status: 'untracked', staged: false, unstaged: true
    })
  })

  it('parseStatus handles detached HEAD', () => {
    const st = GitService.parseStatus('## HEAD (no branch)\n?? x\n')
    expect(st.branch).toBeNull()
    expect(st.files).toHaveLength(1)
  })

  it('parseCommits splits hash/author/date/subject/body', () => {
    const rec = ['abc123', 'Alice', 'a@x', '1700000000', 'Fix bug', 'Long body\nline2', ''].join('\x1f')
    const commits = GitService.parseCommits(rec + '\x1e')
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      hash: 'abc123',
      shortHash: 'abc123',
      author: 'Alice',
      authorEmail: 'a@x',
      date: 1700000000,
      subject: 'Fix bug',
      message: 'Long body\nline2'
    })
  })

  it('parseDiffTree splits files and counts additions/deletions', () => {
    const raw = [
      'diff --git a/a.ts b/a.ts',
      'index 111..222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+another',
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 000..333',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1 @@',
      '+hello'
    ].join('\n')
    const res = GitService.parseDiffTree(raw)
    expect(res.files).toHaveLength(2)
    expect(res.files[0]).toMatchObject({ path: 'a.ts', status: 'modified', additions: 2, deletions: 1 })
    expect(res.files[1]).toMatchObject({ path: 'new.ts', status: 'added', additions: 1, deletions: 0 })
  })

  it('parseBlame maps code lines to commit metadata', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1',
      'author Alice',
      'author-time 1700000000',
      'summary First line',
      '\tconst a = 1',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 2',
      'author Bob',
      'author-time 1700000001',
      'summary Second line',
      '\tconst b = 2'
    ].join('\n')
    const blame = GitService.parseBlame(raw)
    expect(blame).toHaveLength(2)
    expect(blame[0]).toMatchObject({
      finalLine: 1,
      sha: 'a'.repeat(40),
      shortSha: 'a'.repeat(7),
      author: 'Alice',
      authorTime: 1700000000,
      summary: 'First line',
      code: 'const a = 1'
    })
    expect(blame[1]).toMatchObject({ finalLine: 2, author: 'Bob', code: 'const b = 2' })
  })
})

describe('GitService on a real repo', () => {
  let dir: string
  let svc: GitService

  const git = (args: string[], cwd = dir) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' })

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-gitsvc-'))
    git(['init', '-q', '--initial-branch=main'])
    git(['config', 'user.email', 't@t'])
    git(['config', 'user.name', 't'])
    svc = new GitService()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const commitFile = (name: string, content: string, msg: string) => {
    writeFileSync(path.join(dir, name), content)
    git(['add', name])
    git(['commit', '-q', '-m', msg])
  }

  it('returns null status when not a git repo', async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'meow-gitsvc-nr-'))
    try {
      expect(await svc.getStatusDetail(notRepo)).toBeNull()
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })

  it('lists branches, creates and checks out local branch', async () => {
    commitFile('a.txt', 'hi', 'first')
    expect(await svc.getBranches(dir)).toContainEqual({ name: 'main', isRemote: false, isCurrent: true })

    const created = await svc.createBranch(dir, 'feat/x', 'main')
    expect(created).toEqual({ ok: true })

    const checked = await svc.checkout(dir, 'feat/x')
    expect(checked).toEqual({ ok: true })
    const branches = await svc.getBranches(dir)
    expect(branches.find(b => b.name === 'feat/x')?.isCurrent).toBe(true)
    expect(branches.find(b => b.name === 'main')?.isCurrent).toBe(false)
  })

  it('createBranch surfaces git errors', async () => {
    commitFile('a.txt', 'hi', 'first')
    await svc.createBranch(dir, 'feat/x', 'main')
    const res = await svc.createBranch(dir, 'feat/x', 'main')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/already exists/i)
      expect(res.command).toContain('branch')
    }
  })

  it('checkout remote branch creates a local tracking branch', async () => {
    commitFile('a.txt', 'hi', 'first')
    // Simulate a remote by cloning a bare repo and fetching.
    const bare = path.join(dir, '..', path.basename(dir) + '-bare')
    execFileSync('git', ['init', '-q', '--bare', bare])
    execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir })
    git(['push', '-q', 'origin', 'main'])
    git(['branch', 'feat/remote'])
    git(['push', '-q', 'origin', 'feat/remote'])
    git(['branch', '-D', 'feat/remote'])
    git(['fetch', '-q', 'origin'])

    const res = await svc.checkout(dir, 'origin/feat/remote')
    expect(res).toEqual({ ok: true })
    const branches = await svc.getBranches(dir)
    expect(branches.find(b => b.name === 'feat/remote' && !b.isRemote)?.isCurrent).toBe(true)
  })

  it('checkout fails with raw git error when changes would be overwritten', async () => {
    commitFile('a.txt', 'one', 'first')
    git(['checkout', '-q', '-b', 'other'])
    writeFileSync(path.join(dir, 'a.txt'), 'two')
    git(['add', 'a.txt'])
    git(['commit', '-q', '-m', 'second'])

    git(['checkout', '-q', 'main'])
    writeFileSync(path.join(dir, 'a.txt'), 'local-change')
    const res = await svc.checkout(dir, 'other')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/local changes|overwritten/i)
    }
  })

  it('getStatusDetail reports staged, unstaged and untracked files', async () => {
    commitFile('a.txt', 'one', 'first')
    writeFileSync(path.join(dir, 'a.txt'), 'two')
    writeFileSync(path.join(dir, 'b.txt'), 'new')
    git(['add', 'b.txt'])
    writeFileSync(path.join(dir, 'untracked.txt'), 'u')

    const st = await svc.getStatusDetail(dir)
    expect(st).not.toBeNull()
    expect(st!.branch).toBe('main')
    expect(st!.files).toContainEqual(expect.objectContaining({ path: 'a.txt', staged: false, unstaged: true }))
    expect(st!.files).toContainEqual(expect.objectContaining({ path: 'b.txt', staged: true, unstaged: false }))
    expect(st!.files).toContainEqual(expect.objectContaining({ path: 'untracked.txt', status: 'untracked' }))
  })

  it('getDiff returns working tree diff and cached diff separately', async () => {
    commitFile('a.txt', 'one', 'first')
    writeFileSync(path.join(dir, 'a.txt'), 'two')
    git(['add', 'a.txt'])
    writeFileSync(path.join(dir, 'a.txt'), 'three')

    const staged = await svc.getDiff(dir, 'a.txt', true)
    const unstaged = await svc.getDiff(dir, 'a.txt', false)
    expect(staged).toMatch(/one/)
    expect(staged).toMatch(/two/)
    expect(staged).not.toMatch(/three/)
    expect(unstaged).toMatch(/two/)
    expect(unstaged).toMatch(/three/)
  })

  it('getCommits and getFileHistory filter by file', async () => {
    commitFile('a.txt', '1', 'first')
    commitFile('b.txt', 'x', 'second')
    commitFile('a.txt', '2', 'third')

    const all = await svc.getCommits(dir)
    expect(all).toHaveLength(3)
    expect(all[0].subject).toBe('third')

    const history = await svc.getFileHistory(dir, 'a.txt')
    expect(history.map(c => c.subject)).toEqual(['third', 'first'])
  })

  it('getCommitDiff reports added file for a commit', async () => {
    commitFile('a.txt', 'hi', 'first')
    const sha = git(['rev-parse', 'HEAD']).trim()
    const diff = await svc.getCommitDiff(dir, sha)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'a.txt', status: 'added' })
    expect(diff.files[0].raw).toMatch(/\+hi/)
  })

  it('compareCommits returns diff between two commits', async () => {
    commitFile('a.txt', 'one', 'first')
    const first = git(['rev-parse', 'HEAD']).trim()
    commitFile('a.txt', 'two', 'second')
    const second = git(['rev-parse', 'HEAD']).trim()

    const diff = await svc.compareCommits(dir, first, second)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0].raw).toMatch(/one/)
    expect(diff.files[0].raw).toMatch(/two/)
  })

  it('getBlame maps each line to its commit author', async () => {
    commitFile('a.txt', 'line one\nline two\n', 'first')
    writeFileSync(path.join(dir, 'a.txt'), 'line one\nchanged\n')
    git(['add', 'a.txt'])
    git(['commit', '-q', '-m', 'second'])

    const blame = await svc.getBlame(dir, 'a.txt')
    expect(blame).toHaveLength(2)
    expect(blame[0].code).toBe('line one')
    expect(blame[1].code).toBe('changed')
    expect(blame[1].summary).toBe('second')
  })
})
