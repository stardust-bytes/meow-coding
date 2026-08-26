import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { LlmClient } from '../llm'
import { SessionRunner } from '../loop'
import type { TranscriptItem } from '../message'
import type { ChatEvent, ChatMessage, MessageTokens, PromptResponse, SubagentType, ToolCallData } from '../../../shared/types'
import type { CompactionSettings } from '../compact'
import type { TruncationStore } from '../truncation'
import type { SnapshotStore } from '../snapshot'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import { collectSubagentRoles } from '../subagent-roles'
import { decide, deriveSubagentContext } from '../permission'
import type { SubagentRole, ToolPermissionContext } from '../permission'

export type { SubagentType } from '../../../shared/types'

const DEFAULT_MAX_SESSIONS = 20

// Nothing is permitted until a parent context says otherwise: a caller that
// forgets to wire permission gets a subagent that can do nothing, not one that
// can do everything.
const NO_PERMISSION: ToolPermissionContext = {
  mode: 'build',
  rules: {},
  isSavedAllow: () => false,
  canPrompt: false
}

export interface ResolvedSubagentModel {
  provider: string
  model: string
  llm: LlmClient
}

function renderOutput(input: { id: string; description: string; text: string; incomplete?: string }): string {
  const state = input.incomplete
    ? `state="incomplete" reason="${input.incomplete}"`
    : 'state="completed"'
  return [`<task id="${input.id}" ${state}>`, input.text, `</task>`].join('\n')
}

interface SubagentResult {
  text: string
  error?: string
  incomplete?: string
}

export function createTaskTool(opts: {
  llm: LlmClient
  model: string
  tools: Map<string, ToolDefinition>
  // Optional per-role override: a dedicated model + LLM client for subagents.
  resolveSubagent?: (type: SubagentType) => ResolvedSubagentModel | undefined
  // Called when a background subagent finishes so the manager can append the
  // result into the main transcript.
  onBackgroundResult?: (id: string, text: string, error?: string) => void
  // Context budget for the subagent's own loop. Without these a subagent never
  // compacts and its tool output is never capped, so a few large greps push it
  // past the model limit and the provider rejects the whole task.
  maxContextTokens?: number
  maxOutputTokens?: number
  compaction?: CompactionSettings
  toolOutput?: { maxBytes: number; maxLines: number }
  truncation?: TruncationStore
  // Subagent spend is real spend; report it so session cost is not understated.
  onUsage?: (tokens: MessageTokens) => void
  maxSessions?: number
  // The parent's permission context, re-resolved on every call so a mode switch
  // or a newly saved always-allow reaches a subagent already running. Absent,
  // the subagent falls back to NO_PERMISSION and can do nothing.
  permission?: () => ToolPermissionContext
  userAgentsDir?: string
  // Role names shown in the schema description at registration time.
  roleNames?: string[]
  // Bubbles a subagent's permission prompt up to the parent's UI.
  ask?: (promptId: string, tool?: string) => Promise<PromptResponse | null>
  onPromptRequest?: (e: Extract<ChatEvent, { type: 'prompt-request' }>, meta: { taskId: string; subagentType: string }) => void
  // Subagent edits snapshot under the parent's agent id so undo/revert reach them.
  snapshots?: SnapshotStore
  parentAgentId?: string
  maxSteps?: number
  // Hands the caller a handle to cancel a background subagent after the turn
  // that spawned it has ended (the turn's own controller is gone by then).
  onBackgroundStart?: (taskId: string, cancel: () => void) => void
}): ToolDefinition {
  // Resumable subagent sessions, keyed by task id (SDD fix loop reuses them).
  // Bounded so a long-lived agent does not accumulate transcripts forever.
  const maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS
  const knownTools = new Set(opts.tools.keys())
  const resolveRole = (cwd: string, name: string): SubagentRole | { error: string } => {
    const roles = collectSubagentRoles(cwd, knownTools, opts.userAgentsDir)
    const role = roles.find(r => r.name === name)
    if (!role) {
      return { error: `task: unknown subagent_type "${name}". Available: ${roles.map(r => r.name).join(', ')}` }
    }
    const mode = (opts.permission?.() ?? NO_PERMISSION).mode
    if (mode === 'plan' && role.name !== 'research') {
      return { error: `task: only the read-only "research" subagent may run in plan mode (got "${name}")` }
    }
    return role
  }
  const sessions = new Map<string, TranscriptItem[]>()
  const remember = (id: string, items: TranscriptItem[]) => {
    sessions.delete(id)
    sessions.set(id, items)
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next()
      if (oldest.done) break
      sessions.delete(oldest.value)
    }
  }

  const runSubagent = async (
    input: { description?: string; prompt: string; role: SubagentRole },
    ctx: ToolContext,
    id: string,
    items: TranscriptItem[],
    background: boolean,
    signal?: AbortSignal
  ): Promise<SubagentResult> => {
    const role = input.role
    const sub = opts.resolveSubagent?.(role.name)
    const model = role.model?.model ?? sub?.model ?? opts.model
    const safeTools = new Map<string, ToolDefinition>()
    for (const name of role.tools) {
      // A subagent runner has no setTodos sink, so todowrite would silently
      // swallow whatever it is given.
      if (name === 'todowrite') continue
      const def = opts.tools.get(name)
      if (def) safeTools.set(name, def)
    }
    let stopReason: string | undefined
    const runner = new SessionRunner({
      agentId: `sub-${role.name}-${id}`,
      taskId: id,
      model,
      system: role.system,
      cwd: ctx.cwd,
      llm: sub?.llm ?? opts.llm,
      tools: safeTools,
      turn: ctx.turn,
      // Derived fresh on every call so a mode switch or a newly saved
      // always-allow reaches a subagent already running.
      decidePermission: (tool, toolInput) => decide(
        deriveSubagentContext(opts.permission?.() ?? NO_PERMISSION, role, { background }),
        tool,
        toolInput
      ),
      ask: opts.ask ?? (async () => null),
      maxSteps: opts.maxSteps ?? 30,
      maxContextTokens: opts.maxContextTokens,
      maxOutputTokens: opts.maxOutputTokens,
      compaction: opts.compaction,
      toolOutput: opts.toolOutput,
      truncation: opts.truncation,
      replaceItems: (next) => { items.length = 0; items.push(...next) },
      snapshots: opts.snapshots,
      snapshotAgentId: opts.parentAgentId,
      onUsage: opts.onUsage,
      onEvent: (e) => {
        if (e.type === 'text-delta') {
          ctx.emitSubagent?.(id, { sub: 'delta', text: e.delta, parentTaskId: ctx.taskId })
        } else if (e.type === 'reasoning-delta') {
          ctx.emitSubagent?.(id, { sub: 'delta', reasoning: e.delta, parentTaskId: ctx.taskId })
        } else if (e.type === 'tool-start' || e.type === 'tool-result') {
          ctx.emitSubagent?.(id, { sub: 'tool', tool: e.call.tool, parentTaskId: ctx.taskId })
        } else if (e.type === 'done') {
          stopReason = e.reason
          ctx.emitSubagent?.(id, {
            sub: 'done',
            state: e.reason === 'stopped' ? 'cancelled' : 'completed',
            parentTaskId: ctx.taskId
          })
        } else if (e.type === 'error') {
          ctx.emitSubagent?.(id, { sub: 'done', state: 'error', parentTaskId: ctx.taskId })
        } else if (e.type === 'prompt-request') {
          opts.onPromptRequest?.(e, { taskId: id, subagentType: role.name })
        }
      },
      getItems: () => items,
      appendMessage: (m: ChatMessage) => items.push({ kind: 'message', message: m }),
      appendTool: (t: ToolCallData) => items.push({ kind: 'tool', tool: t })
    })

    await runner.run(signal)

    let text = ''
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') {
        text = item.message.text
        break
      }
    }
    if (!text) return { text: '', error: 'task: subagent produced no answer' }
    const incomplete = stopReason === 'max-steps' || stopReason === 'length' ? stopReason : undefined
    return { text, ...(incomplete ? { incomplete } : {}) }
  }

  return {
    name: 'task',
    description:
      'Dispatch a focused task to a subagent (an isolated agent with its own context and tools). ' +
      'Launch multiple task calls in a single message to run them in parallel. ' +
      'Pass task_id to resume a previous subagent session instead of starting fresh. ' +
      'background=true runs the subagent asynchronously and returns immediately; ' +
      'you will see the result in the feed when it finishes.',
    schema: z.object({
      description: z.string().describe('A short (3-5 words) description of the task'),
      prompt: z.string().describe('The task for the subagent to perform'),
      subagent_type: z.string().default('research')
        .describe(`The subagent role to use. Available: ${(opts.roleNames ?? ['research', 'general', 'reviewer']).join(', ')}`),
      task_id: z.string().optional()
        .describe('Resume a previous subagent session (pass the task id from a prior result)'),
      background: z.boolean().optional()
        .describe('Run the subagent in the background and return immediately; result appears in the feed when done')
    }),
    async run(input, ctx: ToolContext): Promise<ToolRunResult> {
      const { description, prompt, subagent_type = 'research', task_id, background } =
        input as unknown as {
          description?: string; prompt: string; subagent_type?: string; task_id?: string; background?: boolean
        }
      const resolved = resolveRole(ctx.cwd, subagent_type)
      if ('error' in resolved) return { error: resolved.error }
      const role = resolved
      const id = task_id ?? randomUUID()
      const items = sessions.get(id) ?? []
      items.push({
        kind: 'message',
        message: { id: randomUUID(), role: 'user', text: prompt, createdAt: Date.now() }
      })
      remember(id, items)

      if (background) {
        // The turn's controller is dropped when the turn ends, so a background
        // subagent needs its own handle or nothing can stop it afterwards.
        const controller = new AbortController()
        const onParentAbort = () => controller.abort()
        ctx.signal?.addEventListener('abort', onParentAbort, { once: true })
        opts.onBackgroundStart?.(id, () => controller.abort())
        ctx.emitSubagent?.(id, { sub: 'start', subagentType: role.name, background: true, parentTaskId: ctx.taskId })
        void runSubagent({ description, prompt, role }, ctx, id, items, true, controller.signal)
          .then(
            (result) => {
              if (result.text) {
                ctx.emitSubagent?.(id, { sub: 'done', state: 'completed', result: result.text, parentTaskId: ctx.taskId })
                opts.onBackgroundResult?.(id, result.text)
              } else {
                ctx.emitSubagent?.(id, { sub: 'done', state: 'error', parentTaskId: ctx.taskId })
                opts.onBackgroundResult?.(id, '', result.error)
              }
            },
            (err) => {
              ctx.emitSubagent?.(id, { sub: 'done', state: 'error', parentTaskId: ctx.taskId })
              opts.onBackgroundResult?.(id, '', String(err))
            }
          )
          .finally(() => ctx.signal?.removeEventListener('abort', onParentAbort))
        return { output: `Subagent ${id} (${role.name}) running in background.`, background: true }
      }

      ctx.emitSubagent?.(id, { sub: 'start', subagentType: role.name })
      const result = await runSubagent({ description, prompt, role }, ctx, id, items, false, ctx.signal)
      if (!result.text) return { error: result.error ?? 'task: subagent produced no answer' }
      return { output: renderOutput({ id, description: description ?? role.name, text: result.text, incomplete: result.incomplete }) }
    }
  }
}
