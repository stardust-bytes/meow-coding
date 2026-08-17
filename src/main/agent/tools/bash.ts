import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface BashInput {
  command: string
  timeoutMs?: number
}

const MAX_OUTPUT = 1024 * 1024

// Git Bash's bash.exe re-execs itself once before running the user's
// command, so the real process tree is bash.exe -> bash.exe -> command,
// not bash.exe -> command. tree-kill's single taskkill /t snapshot can
// miss the innermost command if it fires before that re-exec settles.
// Waiting this long (from spawn time) before killing gives the tree time
// to form. This is a heuristic, not a guarantee: bash -lc is a login
// shell that sources the user's profile (~/.bash_profile, /etc/profile),
// so a heavy profile (nvm/conda/pyenv init, etc.) can push formation
// past this window on some machines, leaving a residual — smaller than
// before this fix, but non-zero — orphan risk. 600ms covers normal
// profile load comfortably without adding perceptible Stop latency,
// since it's measured from spawn time, not from when Stop was pressed.
const WINDOWS_KILL_GRACE_MS = 600

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the project directory and return stdout+stderr. On Windows this runs in ' +
    'Git Bash, so use unix commands (ls, pwd, cat, sed, awk, find, grep, git, npm).',
  schema: z.object({
    command: z.string().describe('The shell command to run.'),
    timeoutMs: z.number().int().optional().describe('Optional timeout in milliseconds.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { command, timeoutMs = 120_000 } = input as unknown as BashInput
    if (!command || typeof command !== 'string') {
      return { error: 'bash: missing "command" (string)' }
    }
    const fallbackCwd = existsSync(ctx.cwd) ? ctx.cwd : homedir()
    const usedFallback = fallbackCwd !== ctx.cwd
    const note = usedFallback
      ? `[meow] working dir "${ctx.cwd}" khong ton tai, chay tu "${fallbackCwd}".\n`
      : ''
    const resolved = buildShellCommand(command, fallbackCwd)
    return new Promise<ToolRunResult>(resolve => {
      const child = spawn(resolved.command, resolved.args, {
        cwd: fallbackCwd,
        env: process.env as Record<string, string>,
        windowsHide: true,
        windowsVerbatimArguments: resolved.verbatim ?? false
      })
      const spawnedAt = Date.now()
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let aborted = false

      const done = (result: ToolRunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const killAfterGrace = (onDone: () => void) => {
        const remaining = process.platform === 'win32'
          ? WINDOWS_KILL_GRACE_MS - (Date.now() - spawnedAt)
          : 0
        const doKill = () => {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
            onDone()
            return
          }
          try {
            kill(child.pid, onDone)
          } catch {
            onDone()
          }
        }
        if (remaining > 0) setTimeout(doKill, remaining)
        else doKill()
      }
      const timer = setTimeout(() => {
        timedOut = true
        killAfterGrace(() => done({ error: `bash: timeout after ${timeoutMs}ms` }))
      }, timeoutMs)
      const onAbort = () => {
        aborted = true
        killAfterGrace(() => done({ error: 'bash: aborted by user' }))
      }
      if (ctx.signal) {
        if (ctx.signal.aborted) onAbort()
        else ctx.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString()
      })
      child.on('error', (err) => done({ error: `bash: ${err.message}` }))
      child.on('close', (code) => {
        if (timedOut || aborted) return
        const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
        const body = output || '(no output)'
        if (code === 0) return done({ output: note + body })
        done({ error: `bash: exit code ${code}\n${note}${output}` })
      })
    })
  }
}

export interface ResolvedShellCommand {
  command: string
  args: string[]
  verbatim?: boolean
}

function whichPath(name: string): string | null {
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  return null
}

// Mirrors opencode: on Windows prefer Git Bash so unix commands and the
// superpowers shell scripts (bash) work. Falls back to cmd.exe.
function gitBashPath(): string | null {
  if (process.env.MEOW_GIT_BASH_PATH) return process.env.MEOW_GIT_BASH_PATH
  const systemDrive = process.env.SystemDrive ?? 'C:'
  const candidates: string[] = [
    path.join(systemDrive, 'Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(systemDrive, 'Program Files (x86)', 'Git', 'bin', 'bash.exe')
  ]
  const git = whichPath('git')
  if (git) candidates.unshift(path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe'))
  return candidates.find(p => existsSync(p)) ?? null
}

export function buildShellCommand(command: string, cwd: string): ResolvedShellCommand {
  if (process.platform === 'win32') {
    const bash = gitBashPath()
    if (bash) {
      // bash -lc with cwd passed as $1; the working directory is already set
      // by spawn, but follow opencode and cd explicitly so profile scripts
      // cannot move us.
      const script = `cd -- "$1" 2>/dev/null || true\n${command}`
      return { command: bash, args: ['-lc', script, 'opencode', cwd], verbatim: false }
    }
    // Pass the whole command as one quoted argv element with windowsVerbatimArguments so cmd
    // /s /c strips the outer quotes and embedded quotes (e.g. cd "D:\...") survive intact.
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', '"' + command + '"'], verbatim: true }
  }
  return { command: 'sh', args: ['-c', command] }
}

export function resolveCwd(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
}
