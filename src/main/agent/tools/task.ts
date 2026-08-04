import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LlmClient } from '../llm'
import { SessionRunner } from '../loop'
import type { TranscriptItem } from '../message'
import type { ChatMessage, ToolCallData } from '../../../shared/types'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'

export type SubagentType = 'research' | 'general' | 'reviewer'

export interface SubagentConfig {
  system: string
  tools: string[]
}

// Mirrors opencode: each subagent is a specialized agent type with its own
// system prompt and tool set. `general` can modify files (SDD implementer),
// `reviewer` inspects diffs read-only, `research` explores read-only.
export const SUBAGENT_CONFIGS: Record<SubagentType, SubagentConfig> = {
  research: {
    system:
      'You are a research subagent. Investigate and answer concisely. ' +
      'You cannot modify files.',
    tools: ['read', 'glob', 'grep', 'webfetch']
  },
  general: {
    system:
      'You are a general-purpose implementation subagent. Implement exactly what is asked: ' +
      'read relevant files first, make changes with write/edit/apply-patch, run tests with bash, ' +
      'commit with git when the task expects it. ' +
      'Return a concise report starting with one status line: DONE, DONE_WITH_CONCERNS, ' +
      'NEEDS_CONTEXT, or BLOCKED, then a summary of changes, test results, and any concerns.',
    tools: ['read', 'glob', 'grep', 'webfetch', 'write', 'edit', 'apply-patch', 'bash', 'git', 'todowrite', 'skill']
  },
  reviewer: {
    system:
      'You are a code review subagent. Inspect the requested changes (use git diff and read) for ' +
      'spec compliance and code quality. Return a verdict line APPROVED or CHANGES_REQUESTED, ' +
      'then a numbered list of findings with severity (Critical / Important / Minor).',
    tools: ['read', 'glob', 'grep', 'git', 'webfetch']
  }
}

function renderOutput(input: { id: string; description: string; text: string }): string {
  return [
    `<task id="${input.id}" state="completed">`,
    `<summary>${input.description}</summary>`,
    '<task_result>',
    input.text,
    '</task_result>',
    '</task>'
  ].join('\n')
}

export function createTaskTool(opts: {
  llm: LlmClient
  model: string
  tools: Map<string, ToolDefinition>
}): ToolDefinition {
  // Resumable subagent sessions, keyed by task id (SDD fix loop reuses them).
  const sessions = new Map<string, TranscriptItem[]>()

  return {
    name: 'task',
    description:
      'Dispatch a focused task to a subagent (an isolated agent with its own context and tools). ' +
      'Launch multiple task calls in a single message to run them in parallel. ' +
      'Pass task_id to resume a previous subagent session instead of starting fresh.',
    schema: z.object({
      description: z.string().describe('A short (3-5 words) description of the task'),
      prompt: z.string().describe('The task for the subagent to perform'),
      subagent_type: z.enum(['research', 'general', 'reviewer']).default('research')
        .describe('The type of subagent to use: research (read-only), general (can write code), reviewer (code review)'),
      task_id: z.string().optional()
        .describe('Resume a previous subagent session (pass the task id from a prior result)')
    }),
    async run(input, ctx: ToolContext): Promise<ToolRunResult> {
      const { description, prompt, subagent_type = 'research', task_id } =
        input as unknown as { description?: string; prompt: string; subagent_type?: SubagentType; task_id?: string }
      const cfg = SUBAGENT_CONFIGS[subagent_type]
      const id = task_id ?? randomUUID()
      const items = sessions.get(id) ?? []
      items.push({
        kind: 'message',
        message: { id: randomUUID(), role: 'user', text: prompt, createdAt: Date.now() }
      })
      sessions.set(id, items)

      const safeTools = new Map<string, ToolDefinition>()
      for (const name of cfg.tools) {
        const def = opts.tools.get(name)
        if (def) safeTools.set(name, def)
      }
      const runner = new SessionRunner({
        agentId: 'sub',
        model: opts.model,
        system: cfg.system,
        cwd: ctx.cwd,
        llm: opts.llm,
        tools: safeTools,
        decidePermission: () => 'allow',
        ask: async () => null,
        maxSteps: 20,
        onEvent: () => {},
        getItems: () => items,
        appendMessage: (m: ChatMessage) => items.push({ kind: 'message', message: m }),
        appendTool: (t: ToolCallData) => items.push({ kind: 'tool', tool: t })
      })
      await runner.run(ctx.signal)

      let text = ''
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') {
          text = item.message.text
          break
        }
      }
      if (!text) return { error: 'task: subagent produced no answer' }
      return { output: renderOutput({ id, description: description ?? subagent_type, text }) }
    }
  }
}
