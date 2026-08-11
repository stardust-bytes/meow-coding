import { randomUUID } from 'node:crypto'
import type { ChatEvent, ChatMessage, MessageTokens, PromptResponse, QuestionPrompt, TodoItem, ToolCallData } from '../../shared/types'
import { appendStreamDelta } from '../../shared/text'
import type { LlmClient, LlmStreamPart } from './llm'
import { formatLlmError } from './llm'
import { toLlmMessages } from './message'
import type { TranscriptItem } from './message'
import type { ToolContext, ToolDefinition } from './tools/types'
import type { PermissionDecision } from './permission'
import { selectHeadTail, serializeItems, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, pruneToolOutputs } from './compact'
import { instructionFilesForFile } from './instructions'
import type { CompactionSettings } from './compact'
import { estimateUsage } from './token'
import type { TruncationStore } from './truncation'
import type { SnapshotStore } from './snapshot'

export interface LoopDeps {
  agentId: string
  model: string
  system: string
  systemInstructionPaths?: ReadonlySet<string>
  cwd: string
  llm: LlmClient
  tools: Map<string, ToolDefinition>
  decidePermission: (toolName: string) => PermissionDecision
  ask: (promptId: string, tool?: string) => Promise<PromptResponse | null>
  maxSteps?: number
  maxContextTokens?: number
  compaction?: CompactionSettings
  toolOutput?: { maxBytes: number; maxLines: number }
  truncation?: TruncationStore
  replaceItems?: (items: TranscriptItem[]) => void
  snapshots?: SnapshotStore
  onEvent: (e: ChatEvent) => void
  getItems: () => TranscriptItem[]
  appendMessage: (msg: ChatMessage) => void
  appendTool: (tool: ToolCallData) => void
  setTodos?: (todos: TodoItem[]) => void
  variantOptions?: Record<string, unknown>
  onUsage?: (tokens: MessageTokens) => void
  computeCost?: (usage: { input: number; output: number }) => number
  diagnostics?: (filePath: string, text: string) => Promise<string>
}

const DEFAULT_MAX_STEPS = 50
const MAX_COMPACT_PER_RUN = 2
const MAX_STEPS_PROMPT = 'Final step: wrap up and provide your final answer now. Tool calls are disabled.'

export class SessionRunner {
  private readonly maxSteps: number
  private compactedThisRun = 0
  // AGENTS.md paths already attached to a read output this session; cross-message
  // dedupe so instructions are not repeated across turns (opencode claims set).
  private attachedInstructions = new Set<string>()

  constructor(private deps: LoopDeps) {
    this.maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS
  }

  async run(signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
    let steps = 0
    this.compactedThisRun = 0
    const runUsage = { input: 0, output: 0, total: 0 }
    while (true) {
      if (signal?.aborted) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }
      steps++
      const isLastStep = steps >= this.maxSteps

      await this.maybeCompact(signal)

      const llmMessages = this.buildMessages(isLastStep)
      let hasToolCall = false
      let textBuffer = ''
      let reasoningBuffer = ''
      let tokens: MessageTokens | undefined
      const calls: ToolCallData[] = []
      const persistPartial = () => {
        if (!textBuffer && !reasoningBuffer) return
        this.deps.appendMessage({
          id: randomUUID(),
          role: 'assistant',
          text: textBuffer,
          reasoning: reasoningBuffer || undefined,
          tokens,
          createdAt: Date.now()
        })
      }
      try {
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system: this.deps.system,
          messages: llmMessages,
          tools: isLastStep ? [] : this.visibleToolDefs(),
          signal,
          variantOptions: this.deps.variantOptions
        })
        for await (const part of stream) {
          if (signal?.aborted) {
            persistPartial()
            this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
            return
          }
          if (part.kind === 'text') {
            const next = appendStreamDelta(textBuffer, part.text ?? '')
            const delta = next.slice(textBuffer.length)
            textBuffer = next
            this.deps.onEvent({ type: 'text-delta', agentId, delta })
          } else if (part.kind === 'reasoning') {
            const next = appendStreamDelta(reasoningBuffer, part.text ?? '')
            const delta = next.slice(reasoningBuffer.length)
            reasoningBuffer = next
            this.deps.onEvent({ type: 'reasoning-delta', agentId, delta })
          } else if (part.kind === 'tool-call') {
            hasToolCall = true
            const call: ToolCallData = {
              id: part.toolCallId ?? randomUUID(),
              tool: part.toolName ?? 'unknown',
              input: part.toolInput ?? {},
              permission: 'pending'
            }
            calls.push(call)
            this.deps.onEvent({ type: 'tool-start', agentId, call })
          } else if (part.kind === 'finish') {
            tokens = part.tokens
            if (part.tokens) {
              runUsage.input += part.tokens.input
              runUsage.output += part.tokens.output
              runUsage.total += part.tokens.total
              // Báo usage ngay mỗi step: nếu user bấm Stop hoặc gặp lỗi giữa
              // chừng, chi phí đã tiêu vẫn được ghi nhận.
              this.deps.onUsage?.(part.tokens)
            }
          } else if (part.kind === 'error') {
            persistPartial()
            this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
            return
          }
        }
      } catch (err) {
        persistPartial()
        if (signal?.aborted) {
          this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        } else {
          this.deps.onEvent({ type: 'error', agentId, message: formatLlmError(err) })
        }
        return
      }

      if (signal?.aborted) {
        persistPartial()
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }

      if (textBuffer || calls.length > 0 || reasoningBuffer) {
        this.deps.appendMessage({
          id: randomUUID(),
          role: 'assistant',
          text: textBuffer,
          reasoning: reasoningBuffer || undefined,
          tokens,
          createdAt: Date.now()
        })
      }

      // Parallel tool execution like opencode: run auto-approved calls
      // concurrently; permission-asking calls run serially afterwards to avoid
      // two prompts at once.
      const askCalls = calls.filter(c => this.deps.decidePermission(c.tool) === 'ask')
      const autoCalls = calls.filter(c => this.deps.decidePermission(c.tool) !== 'ask')
      await Promise.all(autoCalls.map(call => this.executeCall(call, signal)))
      for (const call of askCalls) await this.executeCall(call, signal)

      if (!hasToolCall) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'complete', tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
      if (isLastStep) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'max-steps', tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
    }
  }

  private async executeCall(call: ToolCallData, signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
    const decision = this.deps.decidePermission(call.tool)
    let allowed: boolean
    if (decision === 'allow') {
      allowed = true
    } else if (decision === 'deny') {
      allowed = false
    } else {
      const promptId = randomUUID()
      this.deps.onEvent({ type: 'prompt-request', agentId, promptId, kind: 'permission', call })
      const resp = await this.deps.ask(promptId, call.tool)
      allowed = resp?.allow ?? false
    }

    if (!allowed) {
      call.permission = 'denied'
      const deniedReason = this.deps.decidePermission(call.tool)
      call.error = deniedReason === 'deny'
        ? `tool "${call.tool}" is not permitted in the current mode`
        : 'permission denied by user'
    } else {
      call.permission = 'allowed'
      const def = this.deps.tools.get(call.tool)
      if (!def) {
        call.error = `unknown tool: ${call.tool}`
      } else {
        const toolCtx: ToolContext = {
          cwd: this.deps.cwd,
          signal,
          agentId: this.deps.agentId,
          snapshots: this.deps.snapshots,
          diagnostics: this.deps.diagnostics,
          setTodos: (todos) => this.deps.setTodos?.(todos),
          emitSubagent: (taskId, e) => this.deps.onEvent({
            type: 'subagent-event',
            agentId: this.deps.agentId,
            taskId,
            sub: e.sub,
            subagentType: e.subagentType,
            text: e.text,
            tool: e.tool,
            state: e.state
          }),
          ask: async (question: QuestionPrompt) => {
            const promptId = randomUUID()
            this.deps.onEvent({
              type: 'prompt-request',
              agentId,
              promptId,
              kind: 'question',
              question: question.question,
              options: question.options,
              multiple: question.multiple,
              custom: question.custom
            })
            const resp = await this.deps.ask(promptId)
            return resp?.text ?? null
          },
          onFileRead: (filePath) => {
            const skip = new Set([...this.attachedInstructions, ...(this.deps.systemInstructionPaths ?? [])])
            const files = instructionFilesForFile(filePath, skip)
            if (files.length === 0) return ''
            for (const f of files) this.attachedInstructions.add(f.path)
            return `<system-reminder>\n${files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')}\n</system-reminder>`
          }
        }
        try {
          const r = await def.run(call.input, toolCtx)
          call.output = r.output
          call.error = r.error
        } catch (err) {
          call.error = String(err)
        }
      }
    }
    this.deps.appendTool(call)
    this.deps.onEvent({ type: 'tool-result', agentId, call })
  }

  private visibleToolDefs(): ToolDefinition[] {
    return [...this.deps.tools.values()]
      .filter(t => this.deps.decidePermission(t.name) !== 'deny')
  }

  // Token-based overflow detection (modeled on opencode session/compaction.ts):
  // when the estimated request size approaches the model context limit, run an
  // LLM compaction that summarizes the older head and keeps the recent tail
  // verbatim.
  private async maybeCompact(signal?: AbortSignal): Promise<void> {
    const { compaction, maxContextTokens, replaceItems } = this.deps
    if (!compaction?.auto || !maxContextTokens || maxContextTokens <= 0 || !replaceItems) return
    const usable = maxContextTokens - compaction.buffer
    if (usable <= 0) return
    let items = this.deps.getItems()
    const opts = { toolOutputMaxChars: compaction.toolOutputMaxChars, ...this.truncationOpts() }
    if (estimateUsage(toLlmMessages(items, opts)) < usable) return

    // Prune old tool outputs first (cheap) before spending an LLM compact call.
    const pruned = pruneToolOutputs(items, compaction)
    if (pruned) {
      replaceItems(items)
      if (estimateUsage(toLlmMessages(items, opts)) < usable) return
    }

    const { head, tail } = selectHeadTail(items, compaction.keepTokens, compaction.tailTurns)
    if (head.length === 0) return
    if (this.compactedThisRun >= MAX_COMPACT_PER_RUN) return
    const previousSummary = this.findPreviousSummary(items)
    const prompt = buildCompactionPrompt(previousSummary, serializeItems(head, compaction.toolOutputMaxChars))
    const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
    if (signal?.aborted || !summary) return
    this.compactedThisRun++

    // Render the compaction like opencode: a user marker followed by the summary
    // as an assistant message, then the verbatim recent tail.
    const now = Date.now()
    const markerItem: TranscriptItem = {
      kind: 'message',
      message: { id: randomUUID(), role: 'user', text: COMPACTION_MARKER, createdAt: now }
    }
    const summaryItem: TranscriptItem = {
      kind: 'message',
      message: { id: randomUUID(), role: 'assistant', text: summary, createdAt: now }
    }
    replaceItems([markerItem, summaryItem, ...tail])
    this.deps.onEvent({ type: 'compacted', agentId: this.deps.agentId, summary })
  }

  private truncationOpts(): { truncate?: (toolId: string, text: string) => string } {
    const store = this.deps.truncation
    const cfg = this.deps.toolOutput
    if (!store || !cfg) return {}
    const { maxBytes, maxLines } = cfg
    return { truncate: (toolId, text) => store.truncate(this.deps.agentId, toolId, text, { maxBytes, maxLines }) }
  }

  private findPreviousSummary(items: TranscriptItem[]): string | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind !== 'message' || item.message.role !== 'user') continue
      if (item.message.text !== COMPACTION_MARKER) continue
      const next = items[i + 1]
      if (next?.kind === 'message' && next.message.role === 'assistant') return next.message.text
    }
    return undefined
  }

  private buildMessages(isLastStep = false): ReturnType<typeof toLlmMessages> {
    const items = this.deps.getItems()
    const toolOutputMaxChars = this.deps.compaction?.toolOutputMaxChars
    const messages = toLlmMessages(items, { toolOutputMaxChars, ...this.truncationOpts() })
    return isLastStep ? [...messages, { role: 'user', content: MAX_STEPS_PROMPT }] : messages
  }
}
