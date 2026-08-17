import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export interface OfficeToolDeps {
  resolveBinary: (signal?: AbortSignal) => Promise<string>
  spawnFn?: typeof spawn
}

const MAX_OUTPUT = 1024 * 1024

export function buildOfficeArgs(args: string[]): string[] {
  return args.includes('--json') ? args : [...args, '--json']
}

export function createOfficeTool(deps: OfficeToolDeps): ToolDefinition {
  return {
    name: 'office',
    description:
      'Create, read, analyze, and modify Office documents (.docx, .xlsx, .pptx) via the officecli ' +
      'CLI. Pass the officecli arguments as an argv array (no shell), e.g. ["create","report.docx"] ' +
      'or ["add","deck.pptx","/","--type","slide","--prop","title=Q4"]. "--json" is appended automatically.',
    schema: z.object({
      args: z.array(z.string()).describe('The officecli command arguments, e.g. ["create", "report.docx"].'),
      timeoutMs: z.number().int().optional().describe('Optional timeout in milliseconds.')
    }),
    async run(input, ctx): Promise<ToolRunResult> {
      const { args, timeoutMs = 120_000 } = input as { args?: unknown; timeoutMs?: number }
      if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
        return { error: 'office: missing "args" (string[])' }
      }
      const argv = buildOfficeArgs(args)
      const fallbackCwd = existsSync(ctx.cwd) ? ctx.cwd : homedir()
      const usedFallback = fallbackCwd !== ctx.cwd
      const note = usedFallback
        ? `[meow] working dir "${ctx.cwd}" khong ton tai, chay tu "${fallbackCwd}".\n`
        : ''
      let binary: string
      try {
        binary = await deps.resolveBinary(ctx.signal)
      } catch (err) {
        return {
          error:
            'office: cannot locate officecli binary — ' + (err as Error).message + '. ' +
            'Install it manually (e.g. `npm install -g @officecli/officecli`) or check the download. ' +
            'See https://github.com/iOfficeAI/OfficeCLI'
        }
      }
      const spawnFn = deps.spawnFn ?? spawn
      return new Promise<ToolRunResult>(resolve => {
        const child = spawnFn(binary, argv, {
          cwd: fallbackCwd,
          env: { ...(process.env as Record<string, string>), OFFICECLI_SKIP_UPDATE: '1' },
          windowsHide: true
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
              kill(child.pid, () => done({ error: `office: timeout after ${timeoutMs}ms` }))
            } catch {
              done({ error: `office: timeout after ${timeoutMs}ms` })
            }
          } else {
            done({ error: `office: timeout after ${timeoutMs}ms` })
          }
        }, timeoutMs)
        child.stdout?.on('data', (d) => {
          if (stdout.length < MAX_OUTPUT) stdout += d.toString()
        })
        child.stderr?.on('data', (d) => {
          if (stderr.length < MAX_OUTPUT) stderr += d.toString()
        })
        child.on('error', (err) => done({ error: `office: ${err.message}` }))
        child.on('close', (code) => {
          if (timedOut) return
          const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
          const body = output || '(no output)'
          if (code === 0) return done({ output: note + body })
          done({ error: `office: exit code ${code}\n${note}${output}` })
        })
      })
    }
  }
}
