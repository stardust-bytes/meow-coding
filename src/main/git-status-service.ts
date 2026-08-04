import { execFile } from 'node:child_process'
import type { GitStatus } from '../shared/types'

export class GitStatusService {
  get(projectPath: string): Promise<GitStatus | null> {
    return new Promise(resolve => {
      execFile(
        'git',
        ['status', '--porcelain=v2', '-b'],
        { cwd: projectPath, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 4 },
        (err, stdout) => {
          if (err) return resolve(null)
          resolve(this.parse(stdout))
        }
      )
    })
  }

  parse(stdout: string): GitStatus {
    let branch: string | null = null
    let dirtyCount = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) {
        const value = line.slice('# branch.head '.length)
        branch = value === '(detached)' ? null : value
      } else if (line.length > 0 && !line.startsWith('#')) {
        dirtyCount++
      }
    }
    return { branch, dirtyCount }
  }
}
