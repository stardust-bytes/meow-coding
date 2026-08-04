import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { QuestionPrompt } from '../../../shared/types'

const optionSchema = z.object({
  label: z.string().describe('Display text (1-5 words, concise)'),
  description: z.string().optional().describe('Explanation of choice')
})

export const questionTool: ToolDefinition = {
  name: 'question',
  description:
    'Ask the user a question and return their answer. Use only when you truly need input. ' +
    'For choice questions, provide `options` (label + optional description); answers come back as the ' +
    'selected label(s). When `custom` is enabled (default) the user can also type their own answer.',
  schema: z.object({
    question: z.string().describe('The question to ask the user.'),
    header: z.string().optional().describe('Very short label (max 30 chars)'),
    options: z.array(optionSchema).optional().describe('Available choices'),
    multiple: z.boolean().optional().describe('Allow selecting multiple choices'),
    custom: z.boolean().optional().describe('Allow typing a custom answer (default: true)')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { question, header, options, multiple, custom } = input as unknown as QuestionPrompt
    const answer = await ctx.ask({ question, header, options, multiple, custom })
    if (answer === null || answer.trim() === '') {
      return { error: 'question: user did not answer' }
    }
    return { output: `User answered: ${answer}` }
  }
}
