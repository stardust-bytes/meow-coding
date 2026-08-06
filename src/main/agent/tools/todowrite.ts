import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { TodoItem } from '../../../shared/types'

// Ported from opencode's todowrite.txt: explicit per-task triggers so the
// model updates the list as it works instead of batching one update at the end.
const TODOWRITE_DESCRIPTION = [
  'Create and maintain a structured task list for the current coding session. Tracks progress,',
  'organizes multi-step work, and surfaces status to the user.',
  '',
  '## When to use',
  'Use proactively when:',
  '- The task requires 3+ distinct steps or actions',
  '- The work is non-trivial and benefits from planning',
  '- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list',
  '- New instructions arrive — capture them as todos',
  '- You start a task — mark it `in_progress` (only one at a time) before working',
  '- You finish a task — mark it `completed` and add any follow-ups discovered during the work',
  '',
  '## When NOT to use',
  'Skip when the work is a single, straightforward task, purely informational, or tracking adds no value.',
  '',
  '## States',
  '- `pending` — not started',
  '- `in_progress` — actively working (exactly ONE at a time)',
  '- `completed` — finished and verified',
  '- `cancelled` — no longer needed',
  '',
  '## Rules',
  '- Update status in real time; don\'t batch completions',
  '- Mark `completed` only after the work is actually done, including verification — never based on intent',
  '- Keep exactly one `in_progress` while work remains',
  '- If blocked or partial, keep it `in_progress` and add a follow-up todo describing the blocker',
  '- Items should be specific and actionable; break large work into smaller steps'
].join('\n')

export const todowriteTool: ToolDefinition = {
  name: 'todowrite',
  description: TODOWRITE_DESCRIPTION,
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
