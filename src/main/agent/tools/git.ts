import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export function runGit(cwd: string, args: string[]): Promise<ToolRunResult> {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
        if (!err) return resolve({ output: out || '(no output)' })
        resolve({ error: `git ${args.join(' ')} failed:\n${out || err.message}` })
      }
    )
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
    return runGit(ctx.cwd, argv)
  }
}
