import type { z } from 'zod'
import type { SnapshotStore } from '../snapshot'

export type ToolSchema = z.ZodType | Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}

export interface ToolContext {
  cwd: string
  ask(question: string): Promise<string | null>
  signal?: AbortSignal
  agentId?: string
  snapshots?: SnapshotStore
}

export interface ToolRunResult {
  output?: string
  error?: string
}
