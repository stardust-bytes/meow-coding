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
  emitSubagent?(taskId: string, e: SubagentToolEvent): void
  signal?: AbortSignal
  agentId?: string
  snapshots?: SnapshotStore
  diagnostics?: (filePath: string, text: string) => Promise<string>
  // Returns instruction-reminder text to append to the read tool output
  // ('' when no nearby instructions or already attached) — opencode-style.
  onFileRead?(filePath: string): string
}

export interface SubagentToolEvent {
  sub: 'start' | 'delta' | 'tool' | 'done'
  subagentType?: string
  text?: string
  tool?: string
  reasoning?: string
  background?: boolean
  result?: string
  state?: 'running' | 'completed' | 'cancelled' | 'error'
}

export interface ToolRunResult {
  output?: string
  error?: string
  background?: boolean
}
