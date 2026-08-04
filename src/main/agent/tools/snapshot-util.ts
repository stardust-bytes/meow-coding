import { existsSync, readFileSync } from 'node:fs'
import type { ToolContext } from './types'

export function snapshotFile(ctx: ToolContext, filePath: string): void {
  if (!ctx.snapshots || !ctx.agentId) return
  if (!existsSync(filePath)) return
  try {
    ctx.snapshots.snapshot(ctx.agentId, filePath, readFileSync(filePath, 'utf-8'))
  } catch {
    /* ignore snapshot errors */
  }
}
