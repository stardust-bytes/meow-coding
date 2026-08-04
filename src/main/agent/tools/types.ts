import type { z } from 'zod'
import type { SnapshotStore } from '../snapshot'
import type { QuestionPrompt, TodoItem } from '../../../shared/types'

export type ToolSchema = z.ZodType | Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}

export interface ToolContext {
  cwd: string
  ask(question: QuestionPrompt): Promise<string | null>
  setTodos?(todos: TodoItem[]): void
  signal?: AbortSignal
  agentId?: string
  snapshots?: SnapshotStore
}

export interface ToolRunResult {
  output?: string
  error?: string
}
