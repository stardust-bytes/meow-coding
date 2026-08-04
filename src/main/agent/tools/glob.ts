import { glob } from 'glob'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

const MAX_RESULTS = 200

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern (relative to the project root).',
  schema: z.object({
    pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts".')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { pattern } = input as unknown as { pattern: string }
    const matches = await glob(pattern, {
      cwd: ctx.cwd,
      dot: false,
      posix: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    })
    const list = matches.sort().slice(0, MAX_RESULTS)
    if (list.length === 0) return { output: '(no matches)' }
    const truncated = matches.length > MAX_RESULTS ? `\n... (${matches.length - MAX_RESULTS} more)` : ''
    return { output: list.join('\n') + truncated }
  }
}
