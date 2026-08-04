import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { TodoItem } from '../../../shared/types'

export const todowriteTool: ToolDefinition = {
  name: 'todowrite',
  description:
    'Create and maintain a structured task list for the current session. Use when the work has 3+ ' +
    'distinct steps or benefits from tracking. Items have a status: pending (not started), ' +
    'in_progress (actively working, exactly ONE at a time), completed (finished and verified), ' +
    'cancelled (no longer needed). Update status in real time as you progress; mark completed only ' +
    'after the work is actually done, never based on intent.',
  schema: z.object({
    todos: z.array(z.object({
      content: z.string().describe('Brief description of the task'),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
        .describe('Current status of the task'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level of the task')
    })).describe('The updated todo list')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { todos } = input as unknown as { todos: TodoItem[] }
    ctx.setTodos?.(todos)
    return { output: JSON.stringify(todos, null, 2) }
  }
}
