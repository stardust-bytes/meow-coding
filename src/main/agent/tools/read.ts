import { existsSync, readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'

const MAX_LINES = 2000
const MAX_CHARS = 20000

export const readTool: ToolDefinition = {
  name: 'read',
  description:
    'Read a text file from the project. Returns up to 2000 lines (capped at 20000 ' +
    'characters) by default. Use offset/limit to page through large files.',
  schema: z.object({
    file_path: z.string().describe('Absolute path or path relative to the project root.'),
    offset: z.number().int().nonnegative().optional().describe('0-based line offset.'),
    limit: z.number().int().positive().optional().describe('Max lines to return.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { file_path, offset = 0, limit = MAX_LINES } = input as unknown as {
      file_path: string
      offset?: number
      limit?: number
    }
    const full = resolveCwd(ctx.cwd, file_path)
    if (!existsSync(full)) return { error: `read: file not found: ${file_path}` }
    if (!statSync(full).isFile()) return { error: `read: not a file: ${file_path}` }
    const reminder = ctx.onFileRead?.(full) ?? ''
    const lines = readFileSync(full, 'utf-8').split('\n')
    const slice = lines.slice(offset, offset + limit)
    let out = slice.join('\n')
    if (offset > 0) {
      out = `(lines ${offset + 1}-${Math.min(offset + limit, lines.length)} of ${lines.length})\n` + out
    } else if (lines.length > limit) {
      out = `(showing first ${limit} of ${lines.length} lines)\n` + out
    }
    if (out.length > MAX_CHARS) {
      out = out.slice(0, MAX_CHARS) + '\n[output truncated — use offset/limit to page]\n'
    }
    if (reminder) out += `\n\n${reminder}`
    return { output: out }
  }
}
