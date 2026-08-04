import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LlmClient } from '../llm'
import { SessionRunner } from '../loop'
import type { TranscriptItem } from '../message'
import type { ChatMessage, ToolCallData } from '../../../shared/types'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'

const SAFE_TOOLS = ['read', 'glob', 'grep', 'webfetch']

export function createTaskTool(opts: {
  llm: LlmClient
  model: string
  tools: Map<string, ToolDefinition>
}): ToolDefinition {
  return {
    name: 'task',
    description:
      'Dispatch a focused research task to a subagent that explores the codebase read-only and ' +
      'returns a concise summary. Use for self-contained sub-problems or parallel exploration.',
    schema: z.object({
      prompt: z.string().describe('The task for the subagent.')
    }),
    async run(input, ctx: ToolContext): Promise<ToolRunResult> {
      const { prompt } = input as unknown as { prompt: string }
      const items: TranscriptItem[] = [{
        kind: 'message',
        message: { id: randomUUID(), role: 'user', text: prompt, createdAt: Date.now() }
      }]
      const safeTools = new Map<string, ToolDefinition>()
      for (const name of SAFE_TOOLS) {
        const def = opts.tools.get(name)
        if (def) safeTools.set(name, def)
      }
      const runner = new SessionRunner({
        agentId: 'sub',
        model: opts.model,
        system:
          'You are a research subagent. Use read/glob/grep/webfetch to investigate and answer ' +
          'concisely. You cannot modify files.',
        cwd: ctx.cwd,
        llm: opts.llm,
        tools: safeTools,
        decidePermission: () => 'allow',
        ask: async () => null,
        maxSteps: 12,
        onEvent: () => {},
        getItems: () => items,
        appendMessage: (m: ChatMessage) => items.push({ kind: 'message', message: m }),
        appendTool: (t: ToolCallData) => items.push({ kind: 'tool', tool: t })
      })
      await runner.run(ctx.signal)
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') {
          return { output: item.message.text }
        }
      }
      return { error: 'task: subagent produced no answer' }
    }
  }
}
