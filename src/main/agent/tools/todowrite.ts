import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export const todowriteTool: ToolDefinition = {
  name: 'todowrite',
  description:
    'Write down the current task list as a numbered todo list. Use it to plan multi-step work ' +
    'and update it as you make progress.',
  schema: z.object({
    todos: z.array(z.string()).describe('The ordered list of todo items.')
  }),
  async run(input): Promise<ToolRunResult> {
    const { todos } = input as unknown as { todos: string[] }
    const list = todos.map((t, i) => `${i + 1}. ${t}`).join('\n')
    return { output: `TODO list:\n${list}` }
  }
}
