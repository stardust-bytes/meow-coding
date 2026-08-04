import type { z } from 'zod'

export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodType<Record<string, unknown>>
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}

export interface ToolContext {
  cwd: string
  ask(question: string): Promise<string | null>
  signal?: AbortSignal
}

export interface ToolRunResult {
  output?: string
  error?: string
}
