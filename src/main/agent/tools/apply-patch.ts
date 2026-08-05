import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { snapshotFile } from './snapshot-util'
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
        snapshotFile(ctx, full)
        mkdirSync(path.dirname(full), { recursive: true })
        writeFileSync(full, content)
      },
      deleteFile: (p: string) => rmSync(resolveCwd(ctx.cwd, p), { force: true })
    }
    try {
      const files = applyUnifiedPatch(patch, io)
      if (files.length === 0) return { output: '(no file changes in patch)' }
      let output = files
        .map(f => `${f.created ? 'created' : 'updated'} ${f.filePath}`)
        .join('\n')
      if (ctx.diagnostics) {
        const diags: string[] = []
        for (const f of files) {
          const full = resolveCwd(ctx.cwd, f.filePath)
          if (!existsSync(full)) continue
          const d = await ctx.diagnostics(full, readFileSync(full, 'utf-8'))
          if (d) diags.push(d)
        }
        if (diags.length > 0) output += '\n' + diags.join('\n')
      }
      return { output }
    } catch (err) {
      return { error: `apply-patch: ${String(err)}` }
    }
  }
}
