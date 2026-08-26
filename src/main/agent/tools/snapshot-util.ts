import { existsSync, readFileSync } from 'node:fs'
import type { ToolContext } from './types'

export function snapshotFile(ctx: ToolContext, filePath: string): void {
  const agentId = ctx.snapshotAgentId ?? ctx.agentId
  if (!ctx.snapshots || !agentId) return
  if (!existsSync(filePath)) return
  try {
    ctx.snapshots.snapshot(agentId, filePath, readFileSync(filePath, 'utf-8'))
  } catch {
    /* ignore snapshot errors */
  }
}
