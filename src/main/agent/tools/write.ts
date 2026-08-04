import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { snapshotFile } from './snapshot-util'

export const writeTool: ToolDefinition = {
  name: 'write',
  description: 'Create or overwrite a file in the project with the given content.',
  schema: z.object({
    file_path: z.string().describe('Absolute path or path relative to the project root.'),
    content: z.string().describe('The full new content of the file.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { file_path, content } = input as unknown as { file_path: string; content: string }
    const full = resolveCwd(ctx.cwd, file_path)
    snapshotFile(ctx, full)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
    return { output: `wrote ${file_path}` }
  }
}
