import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export const revertTool: ToolDefinition = {
  name: 'revert',
  description:
    'Revert files modified during this session back to their original content (undo tool changes).',
  schema: z.object({}),
  async run(_input, ctx): Promise<ToolRunResult> {
    if (!ctx.snapshots || !ctx.agentId) return { error: 'revert: unavailable in this context' }
    const list = ctx.snapshots.list(ctx.agentId)
    if (list.length === 0) return { output: '(no changes to revert)' }
    let reverted = 0
    let failed = 0
    for (const { filePath } of list) {
      const content = ctx.snapshots.restore(ctx.agentId, filePath)
      if (content === null) continue
      try {
        writeFileSync(filePath, content)
        reverted++
      } catch {
        failed++
      }
    }
    return { output: `reverted ${reverted} file(s)${failed ? `, ${failed} failed` : ''}` }
  }
}
