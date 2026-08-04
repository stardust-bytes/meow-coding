import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { snapshotFile } from './snapshot-util'

export const editTool: ToolDefinition = {
  name: 'edit',
  description:
    'Replace an exact old_string with new_string inside a file. old_string must match exactly once.',
  schema: z.object({
    file_path: z.string().describe('Absolute path or path relative to the project root.'),
    old_string: z.string().describe('The exact text to find and replace.'),
    new_string: z.string().describe('The replacement text.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { file_path, old_string, new_string } = input as unknown as {
      file_path: string
      old_string: string
      new_string: string
    }
    const full = resolveCwd(ctx.cwd, file_path)
    if (!existsSync(full)) return { error: `edit: file not found: ${file_path}` }
    const content = readFileSync(full, 'utf-8')
    const matches = content.split(old_string).length - 1
    if (matches === 0) return { error: 'edit: old_string not found in file' }
    if (matches > 1) return { error: `edit: old_string matched ${matches} times; make it unique` }
    snapshotFile(ctx, full)
    writeFileSync(full, content.replace(old_string, new_string))
    return { output: `edited ${file_path}` }
  }
}
