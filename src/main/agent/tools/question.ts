import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export const questionTool: ToolDefinition = {
  name: 'question',
  description: 'Ask the user a question and return their answer. Use only when you truly need input.',
  schema: z.object({
    question: z.string().describe('The question to ask the user.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { question } = input as unknown as { question: string }
    const answer = await ctx.ask(question)
    if (answer === null || answer.trim() === '') {
      return { error: 'question: user did not answer' }
    }
    return { output: `User answered: ${answer}` }
  }
}
