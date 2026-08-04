import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { applyUnifiedPatch } from '../apply-patch'

export const applyPatchTool: ToolDefinition = {
  name: 'apply-patch',
  description:
    'Apply a unified diff patch to the project. Supports creating, editing and deleting files.',
  schema: z.object({
    patch: z.string().describe('A unified diff with ---/+++ headers and @@ hunks.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { patch } = input as unknown as { patch: string }
    const io = {
      readFile: (p: string) => {
        const full = resolveCwd(ctx.cwd, p)
        return existsSync(full) ? readFileSync(full, 'utf-8') : null
      },
      writeFile: (p: string, content: string) => {
        const full = resolveCwd(ctx.cwd, p)
        mkdirSync(path.dirname(full), { recursive: true })
        writeFileSync(full, content)
      },
      deleteFile: (p: string) => rmSync(resolveCwd(ctx.cwd, p), { force: true })
    }
    try {
      const files = applyUnifiedPatch(patch, io)
      if (files.length === 0) return { output: '(no file changes in patch)' }
      return {
        output: files
          .map(f => `${f.created ? 'created' : 'updated'} ${f.filePath}`)
          .join('\n')
      }
    } catch (err) {
      return { error: `apply-patch: ${String(err)}` }
    }
  }
}
