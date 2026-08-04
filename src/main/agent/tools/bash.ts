import { spawn } from 'node:child_process'
import path from 'node:path'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface BashInput {
  command: string
  timeoutMs?: number
}

const MAX_OUTPUT = 1024 * 1024

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the project directory and return its stdout+stderr. ' +
    'Use for running builds, tests, and inspecting the environment.',
  schema: z.object({
    command: z.string().describe('The shell command to run.'),
    timeoutMs: z.number().int().optional().describe('Optional timeout in milliseconds.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { command, timeoutMs = 120_000 } = input as unknown as BashInput
    if (!command || typeof command !== 'string') {
      return { error: 'bash: missing "command" (string)' }
    }
    const resolved = buildShellCommand(command)
    return new Promise<ToolRunResult>(resolve => {
      const child = spawn(resolved.command, resolved.args, {
        cwd: ctx.cwd,
        env: process.env as Record<string, string>,
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32'
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false

      const done = (result: ToolRunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid) {
          try {
            kill(child.pid, () => done({ error: `bash: timeout after ${timeoutMs}ms` }))
          } catch {
            done({ error: `bash: timeout after ${timeoutMs}ms` })
          }
        } else {
          done({ error: `bash: timeout after ${timeoutMs}ms` })
        }
      }, timeoutMs)

      child.stdout.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString()
      })
      child.on('error', (err) => done({ error: `bash: ${err.message}` }))
      child.on('close', (code) => {
        if (timedOut) return
        const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
        if (code === 0) return done({ output: output || '(no output)' })
        done({ error: `bash: exit code ${code}${output ? '\n' + output : ''}` })
      })
    })
  }
}

export function buildShellCommand(command: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    // Pass the whole command as one quoted argv element with windowsVerbatimArguments so cmd
    // /s /c strips the outer quotes and embedded quotes (e.g. cd "D:\...") survive intact.
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', '"' + command + '"'] }
  }
  return { command: 'sh', args: ['-c', command] }
}

export function resolveCwd(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
}
