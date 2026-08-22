import { execFile } from 'node:child_process'
import type {
  GitActionResult, GitBlameLine, GitBranch, GitCommit, GitDiffFile, GitDiffResult, GitFileChange, GitStatusDetail
} from '../shared/types'

const TIMEOUT_MS = 15000
const MAX_BUFFER = 64 * 1024 * 1024

export class GitCommandError extends Error {
  readonly command: string
  readonly stderr: string
  constructor(command: string, stderr: string) {
    super(stderr.trim() || `git ${command} failed`)
    this.command = command
    this.stderr = stderr
  }
}

const COMMIT_FORMAT = '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e'

export class GitService {
  private run(projectPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd: projectPath, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER },
        (err, stdout, stderr) => {
          if (err) reject(new GitCommandError(args.join(' '), stderr || (err as Error).message))
          else resolve({ stdout, stderr })
        }
      )
    })
  }

  private async runResult(projectPath: string, args: string[]): Promise<GitActionResult> {
    try {
      await this.run(projectPath, args)
      return { ok: true }
    } catch (err) {
      if (err instanceof GitCommandError) {
        return { ok: false, error: err.stderr || err.message, command: err.command }
      }
      return { ok: false, error: String(err), command: args.join(' ') }
    }
  }

  // --- branches -----------------------------------------------------------

  static parseBranches(stdout: string): GitBranch[] {
    const out: GitBranch[] = []
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const [refname, head] = line.split('\t')
      if (!refname) continue
      let name: string
      let isRemote: boolean
      if (refname.startsWith('refs/remotes/')) {
        isRemote = true
        name = refname.slice('refs/remotes/'.length)
      } else if (refname.startsWith('refs/heads/')) {
        isRemote = false
        name = refname.slice('refs/heads/'.length)
      } else {
        continue // e.g. refs/stash, tag refs — not switchable branches
      }
      out.push({
        name,
        isRemote,
        isCurrent: head?.trim() === '*'
      })
    }
    return out
  }

  async getBranches(projectPath: string): Promise<GitBranch[]> {
    const { stdout } = await this.run(projectPath, [
      'branch', '-a', '--format=%(refname)%09%(HEAD)'
    ])
    return GitService.parseBranches(stdout)
  }

  async createBranch(projectPath: string, name: string, base: string): Promise<GitActionResult> {
    return this.runResult(projectPath, ['branch', name, base])
  }

  async checkout(projectPath: string, branch: string): Promise<GitActionResult> {
    if (branch.startsWith('origin/')) {
      const short = branch.slice('origin/'.length)
      // Create a local tracking branch; fail cleanly if it already exists.
      const check = await this.runResult(projectPath, ['rev-parse', '--verify', `refs/heads/${short}`])
      if (check.ok) return this.runResult(projectPath, ['checkout', short])
      return this.runResult(projectPath, ['checkout', '-b', short, '--track', branch])
    }
    return this.runResult(projectPath, ['checkout', branch])
  }

  // --- stash --------------------------------------------------------------

  async stashPush(projectPath: string): Promise<GitActionResult> {
    return this.runResult(projectPath, ['stash', 'push', '-u', '-m', 'meow-switch'])
  }

  async stashPop(projectPath: string): Promise<GitActionResult> {
    return this.runResult(projectPath, ['stash', 'pop'])
  }

  async discard(projectPath: string): Promise<GitActionResult> {
    const co = await this.runResult(projectPath, ['checkout', '--', '.'])
    if (!co.ok) return co
    // -f removes untracked files/dirs; -x is intentionally omitted so ignored
    // files (node_modules, out) survive a discard.
    return this.runResult(projectPath, ['clean', '-fd'])
  }

  // --- status -------------------------------------------------------------

  static parseStatus(stdout: string): GitStatusDetail {
    let branch: string | null = null
    const files: GitFileChange[] = []
    for (const line of stdout.split('\n')) {
      if (line.startsWith('## ')) {
        const rest = line.slice(3)
        const branchPart = rest.split('...')[0]
        branch = branchPart === 'HEAD (no branch)' ? null : branchPart
        continue
      }
      if (!line.trim()) continue
      const xy = line.slice(0, 2)
      if (xy === '??') {
        files.push({ path: line.slice(3), status: 'untracked', staged: false, unstaged: true })
        continue
      }
      // porcelain v1: "XY path"; path is the whole remainder (may contain
      // spaces). Renames render as "old -> new".
      const staged = xy[0] !== ' ' && xy[0] !== '?'
      const unstaged = xy[1] !== ' '
      let path = line.slice(3)
      let status: GitFileChange['status'] = 'modified'
      if (xy[0] === 'A') status = 'added'
      else if (xy[0] === 'D') status = 'deleted'
      else if (xy[0] === 'R' || xy[1] === 'R') {
        status = 'renamed'
        path = path.includes(' -> ') ? path.split(' -> ')[1] : path
      } else if (xy[0] === 'T' || xy[1] === 'T') status = 'typechange'
      files.push({ path, status, staged, unstaged })
    }
    return { branch, headOid: null, files }
  }

  async getStatusDetail(projectPath: string): Promise<GitStatusDetail | null> {
    try {
      const { stdout } = await this.run(projectPath, ['status', '--porcelain', '-b'])
      return GitService.parseStatus(stdout)
    } catch {
      return null
    }
  }

  // --- diff ---------------------------------------------------------------

  async getDiff(projectPath: string, file?: string, staged = false): Promise<string> {
    const args = ['diff']
    if (staged) args.push('--cached')
    if (file) args.push('--', file)
    const { stdout } = await this.run(projectPath, args)
    return stdout
  }

  static parseDiffTree(stdout: string): GitDiffResult {
    const files: GitDiffFile[] = []
    const blocks = stdout.split('\ndiff --git ')
    for (let i = 0; i < blocks.length; i++) {
      let block = blocks[i]
      if (i > 0) block = `diff --git ${block}`
      if (!block.startsWith('diff --git ')) continue
      const headerLines = block.split('\n')
      const first = headerLines[0]
      // "diff --git a/x b/x" or "diff --git a/x b/y" (rename)
      const m = first.match(/^diff --git a\/(.*?) b\/(.*)$/)
      if (!m) continue
      const raw = block
      let additions = 0
      let deletions = 0
      for (const l of headerLines) {
        if (/^\+[^+]/.test(l)) additions++
        else if (/^-[^-]/.test(l)) deletions++
      }
      let status = 'modified'
      if (raw.includes('\nnew file mode')) status = 'added'
      else if (raw.includes('\ndeleted file mode')) status = 'deleted'
      else if (raw.includes('\nrename from ') || raw.includes('\nsimilarity index')) status = 'renamed'
      else if (raw.includes('\nold mode ') && raw.includes('\nnew mode ')) status = 'typechange'
      files.push({
        path: m[2],
        status,
        additions,
        deletions,
        raw: raw.trimEnd()
      })
    }
    return { files }
  }

  async getCommitDiff(projectPath: string, sha: string): Promise<GitDiffResult> {
    // `git show` without --format skips the commit header and uses a combined
    // diff for merge commits (--cc), which parseDiffTree can consume.
    const { stdout } = await this.run(projectPath, ['show', '--format=', sha])
    return GitService.parseDiffTree(stdout)
  }

  async compareCommits(projectPath: string, a: string, b: string): Promise<GitDiffResult> {
    const { stdout } = await this.run(projectPath, ['diff', a, b])
    return GitService.parseDiffTree(stdout)
  }

  // --- log ----------------------------------------------------------------

  static parseCommits(stdout: string): GitCommit[] {
    const out: GitCommit[] = []
    for (const rec of stdout.split('\x1e')) {
      if (!rec.trim()) continue
      // Git appends a newline after the %x1e record separator for every
      // commit, so records after the first carry a leading "\n" — strip it
      // or the hash becomes "\\n432402…" and git rejects it downstream.
      const fields = rec.trim().split('\x1f')
      const [hash, author, authorEmail, dateStr, subject, ...body] = fields
      if (!hash) continue
      out.push({
        hash,
        shortHash: hash.slice(0, 7),
        author,
        authorEmail: authorEmail ?? '',
        date: Number(dateStr) || 0,
        subject: subject ?? '',
        // Trailing empty body field yields a dangling \x1f before the record
        // separator; strip it so multi-line messages stay clean.
        message: body.join('\x1f').replace(/\x1f+$/, '').trim()
      })
    }
    return out
  }

  async getCommits(projectPath: string, file?: string, count = 200): Promise<GitCommit[]> {
    const args = ['log', '-n', String(count), COMMIT_FORMAT]
    if (file) args.push('--follow', '--', file)
    const { stdout } = await this.run(projectPath, args)
    return GitService.parseCommits(stdout)
  }

  async getFileHistory(projectPath: string, file: string): Promise<GitCommit[]> {
    const { stdout } = await this.run(projectPath, [
      'log', '-n', '200', '--follow', COMMIT_FORMAT, '--', file
    ])
    return GitService.parseCommits(stdout)
  }

  // --- blame --------------------------------------------------------------

  static parseBlame(stdout: string): GitBlameLine[] {
    const out: GitBlameLine[] = []
    let cur: Partial<GitBlameLine> | null = null
    for (const line of stdout.split('\n')) {
      if (line.startsWith('\t')) {
        if (cur && cur.sha && cur.finalLine != null) {
          out.push({
            finalLine: cur.finalLine,
            origLine: cur.origLine ?? 0,
            sha: cur.sha,
            shortSha: cur.sha.slice(0, 7),
            author: cur.author ?? '',
            authorTime: cur.authorTime ?? 0,
            summary: cur.summary ?? '',
            code: line.slice(1)
          })
        }
        cur = null
      } else if (cur) {
        if (line.startsWith('author ')) cur.author = line.slice('author '.length)
        else if (line.startsWith('author-time ')) cur.authorTime = Number(line.slice('author-time '.length))
        else if (line.startsWith('summary ')) cur.summary = line.slice('summary '.length)
      } else {
        const m = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/)
        if (m) {
          cur = {
            sha: m[1],
            origLine: Number(m[2]),
            finalLine: Number(m[3])
          }
        }
      }
    }
    return out
  }

  async getBlame(projectPath: string, file: string): Promise<GitBlameLine[]> {
    const { stdout } = await this.run(projectPath, ['blame', '--line-porcelain', '--', file])
    return GitService.parseBlame(stdout)
  }
}
