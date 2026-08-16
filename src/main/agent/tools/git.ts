import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<ToolRunResult> {
  const resolvedCwd = existsSync(cwd) ? cwd : homedir()
  return new Promise(resolve => {
    let settled = false
    let aborted = false

    const child = execFile('git', args, {
      cwd: resolvedCwd,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
      if (aborted) return resolve({ error: 'git: aborted by user' })
      if (!err) return resolve({ output: out || '(no output)' })
      resolve({ error: `git ${args.join(' ')} failed:\n${out || err.message}` })
    })

    const onAbort = () => {
      aborted = true
      if (child.pid) {
        try {
          kill(child.pid, () => {
            if (!settled) {
              settled = true
              resolve({ error: 'git: aborted by user' })
            }
          })
        } catch {
          if (!settled) {
            settled = true
            resolve({ error: 'git: aborted by user' })
          }
        }
      } else {
        if (!settled) {
          settled = true
          resolve({ error: 'git: aborted by user' })
        }
      }
    }

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export const gitTool: ToolDefinition = {
  name: 'git',
  description:
    'Run a git command in the project directory (e.g. "diff", "status", "log --oneline -5", ' +
    '"commit -am msg", "revert", "stash"). Use for reviewing and committing changes.',
  schema: z.object({
    args: z.string().describe('The git arguments, e.g. "diff" or "log --oneline -5".')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { args } = input as unknown as { args: string }
    if (!args || typeof args !== 'string') return { error: 'git: missing "args"' }
    const argv = (args.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(a => a.replace(/^"|"$/g, ''))
    if (argv.length === 0) return { error: 'git: empty args' }
    return runGit(ctx.cwd, argv, ctx.signal)
  }
}
