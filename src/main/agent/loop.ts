import { randomUUID } from 'node:crypto'
import type { ArtifactEntry, ChatEvent, ChatMessage, MessageTokens, PromptResponse, QuestionPrompt, QueuedMessage, TodoItem, ToolCallData } from '../../shared/types'
import { appendStreamDelta } from '../../shared/text'
import type { LlmClient, LlmStreamPart } from './llm'
import { formatLlmError } from './llm'
import { toLlmMessages } from './message'
import type { ToLlmOptions, TranscriptItem } from './message'
import type { ToolContext, ToolDefinition } from './tools/types'
import type { PermissionDecision } from './permission'
import { selectHeadTail, serializeItems, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, pruneToolOutputs, hardTruncate, usableContextTokens, fitHeadToBudget } from './compact'
import { instructionFilesForFile } from './instructions'
import type { CompactionSettings } from './compact'
import { estimateUsage } from './token'
import { DEFAULT_MAX_CONTEXT_TOKENS } from './config'
import { classifyContextOverflowError } from './limits'
import type { TruncationStore } from './truncation'
import type { SnapshotStore } from './snapshot'

export interface LoopDeps {
  agentId: string
  taskId?: string
  turn?: number
  model: string
  /**
   * A function is re-resolved at the start of every run, so skills added or an
   * AGENTS.md edited mid-session take effect on the next turn instead of only
   * after a reload. Resolved once per run, not per step, because building it
   * reads instruction files off disk.
   */
  system: string | (() => string)
  systemInstructionPaths?: ReadonlySet<string>
  cwd: string
  llm: LlmClient
  tools: Map<string, ToolDefinition>
  decidePermission: (toolName: string, input?: Record<string, unknown>) => PermissionDecision
  ask: (promptId: string, tool?: string) => Promise<PromptResponse | null>
  maxSteps?: number
  maxContextTokens?: number
  /**
   * Tokens the model may generate. Reserved from the context budget as well as
   * sent to the provider: leaving it out let the prompt grow to the limit and
   * then be rejected once the model started writing its answer.
   */
  maxOutputTokens?: number
  /**
   * Giá trị đã xác minh gửi provider làm `max_tokens`; undefined = omit hẳn
   * (provider tự chọn) — không thể lỗi `max_tokens exceeds`. Khác `maxOutputTokens`
   * (reserve, chỉ cho compaction/footer).
   */
  maxOutputTokensWire?: number
  /** Provider reject context overflow — ghi trần context học được. */
  onContextOverflow?: (promptTokens: number, message?: string) => void
  compaction?: CompactionSettings
  toolOutput?: { maxBytes: number; maxLines: number }
  truncation?: TruncationStore
  replaceItems?: (items: TranscriptItem[]) => void
  snapshots?: SnapshotStore
  snapshotAgentId?: string
  onEvent: (e: ChatEvent) => void
  onArtifact?: (entry: Omit<ArtifactEntry, 'id' | 'ts'>) => void
  getItems: () => TranscriptItem[]
  appendMessage: (msg: ChatMessage) => void
  appendTool: (tool: ToolCallData) => void
  // Returns and clears all pending steered messages (injected at the next step
  // boundary while a turn is running, opencode-style).
  takeSteers?: () => QueuedMessage[]
  setTodos?: (todos: TodoItem[]) => void
  variantOptions?: Record<string, unknown>
  onUsage?: (tokens: MessageTokens) => void
  computeCost?: (usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) => number
  diagnostics?: (filePath: string, text: string) => Promise<string>
}

const DEFAULT_MAX_STEPS = 50
const DEFAULT_KEEP_FULL_TURNS = 2
const MAX_COMPACT_PER_RUN = 2
const MAX_STEPS_PROMPT = 'Final step: wrap up and provide your final answer now. Tool calls are disabled.'

export class SessionRunner {
  private readonly maxSteps: number
  private compactedThisRun = 0
  // Số lần đã tự sửa reject context-overflow trong một run — cùng giới hạn với
  // compact để một prompt thật sự vượt trần emit lỗi thay vì loop.
  private rejectRetriesThisRun = 0
  // Provider-reported usage of the last LLM call; overflow detection trusts it
  // over the transcript char estimate because it includes the system prompt and
  // tool definitions (see maybeCompact).
  private lastTokens: MessageTokens | undefined
  // AGENTS.md paths already attached to a read output this session; cross-message
  // dedupe so instructions are not repeated across turns (opencode claims set).
  private attachedInstructions = new Set<string>()

  constructor(private deps: LoopDeps) {
    this.maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS
  }

  async run(signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
    const system = typeof this.deps.system === 'function' ? this.deps.system() : this.deps.system
    let steps = 0
    this.compactedThisRun = 0
    this.rejectRetriesThisRun = 0
    const runUsage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }
    while (true) {
      if (signal?.aborted) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }
      const steers = this.deps.takeSteers?.() ?? []
      if (steers.length > 0) {
        for (const s of steers) {
          const msg: ChatMessage = {
            id: s.id,
            role: 'user',
            text: s.text,
            displayText: s.displayText ?? s.text,
            images: s.images,
            createdAt: Date.now()
          }
          this.deps.appendMessage(msg)
          this.deps.onEvent({ type: 'user-message', agentId, message: msg })
        }
        // Fresh step budget for the continued work, like opencode's
        // currentStep reset after promoting steers.
        steps = 0
        continue
      }
      steps++
      const isLastStep = steps >= this.maxSteps

      await this.compactIfOverThreshold(signal)

      const llmMessages = this.buildMessages(isLastStep)
      let hasToolCall = false
      let textBuffer = ''
      let reasoningBuffer = ''
      let tokens: MessageTokens | undefined
      let finishReason: string | undefined
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
      let recover = false
      try {
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system,
          messages: llmMessages,
          tools: isLastStep ? [] : this.visibleToolDefs(),
          signal,
          maxOutputTokens: this.deps.maxOutputTokensWire,
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
            finishReason = part.finishReason
            if (part.tokens) {
              this.lastTokens = part.tokens
              runUsage.input += part.tokens.input
              runUsage.output += part.tokens.output
              runUsage.total += part.tokens.total
              runUsage.cacheRead += part.tokens.cacheRead ?? 0
              runUsage.cacheWrite += part.tokens.cacheWrite ?? 0
              // Báo usage ngay mỗi step: nếu user bấm Stop hoặc gặp lỗi giữa
              // chừng, chi phí đã tiêu vẫn được ghi nhận.
              this.deps.onUsage?.(part.tokens)
            }
          } else if (part.kind === 'error') {
            // Thử tự sửa trước; persistPartial chỉ khi không recover — retry
            // dựng lại transcript từ đầu, persist trước sẽ nhân đôi text.
            if (await this.tryRecoverFromReject(llmMessages, part.error, signal)) {
              steps--
              recover = true
              break
            }
            persistPartial()
            this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
            return
          }
        }
      } catch (err) {
        const message = formatLlmError(err)
        if (await this.tryRecoverFromReject(llmMessages, message, signal)) {
          steps--
          continue
        }
        persistPartial()
        if (signal?.aborted) {
          this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        } else {
          this.deps.onEvent({ type: 'error', agentId, message })
        }
        return
      }
      // Recover thành công ở error-part → retry step (đã steps--). Nếu signal
      // aborted giữa chừng, vòng while kiểm tra lại ở đầu và emit 'stopped'.
      if (recover) continue

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
      const decided = calls.map(call => ({ call, decision: this.deps.decidePermission(call.tool, call.input) }))
      const autoCalls = decided.filter(d => d.decision !== 'ask')
      const askCalls = decided.filter(d => d.decision === 'ask')
      await Promise.all(autoCalls.map(d => this.executeCall(d.call, d.decision, signal)))
      for (const d of askCalls) await this.executeCall(d.call, d.decision, signal)

      if (!hasToolCall) {
        // 'length' means the provider cut the answer off at the output cap.
        // Reporting that as 'complete' left the user reading a truncated reply
        // with nothing to say it was truncated.
        const reason = finishReason === 'length' ? 'length' : 'complete'
        this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
      if (isLastStep) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'max-steps', tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
    }
  }

  private async executeCall(call: ToolCallData, decision: PermissionDecision, signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
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
      call.error = decision === 'deny'
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
          taskId: this.deps.taskId,
          turn: this.deps.turn,
          snapshots: this.deps.snapshots,
          snapshotAgentId: this.deps.snapshotAgentId,
          diagnostics: this.deps.diagnostics,
          setTodos: (todos) => this.deps.setTodos?.(todos),
          emitSubagent: (taskId, e) => this.deps.onEvent({
            type: 'subagent-event',
            agentId: this.deps.agentId,
            taskId,
            parentTaskId: e.parentTaskId,
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
          },
          onArtifact: (entry) => this.deps.onArtifact?.(entry)
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

  // Khi usable <= 0 (context nhỏ hơn buffer + reserve — thường là model có
  // context thật nhỏ học từ learned-limits), compaction phải vẫn chạy, không
  // được tắt: dùng trần cứng limit - reserve (luôn >= limit/2 vì reserve <=
  // floor(limit/2)), để self-heal (compact-on-reject / forceCompact) còn chỗ
  // thu gọn transcript.
  private compactionTarget(limit: number, buffer: number, reserve = 0): number {
    const usable = usableContextTokens(limit, buffer, reserve)
    return usable > 0 ? usable : Math.max(1, limit - reserve)
  }

  // Token-based overflow detection (modeled on opencode session/compaction.ts):
  // when the estimated request size approaches the model context limit, run an
  // LLM compaction that summarizes the older head and keeps the recent tail
  // verbatim.
  async compactIfOverThreshold(signal?: AbortSignal): Promise<void> {
    const { compaction, maxContextTokens, replaceItems } = this.deps
    if (!compaction?.auto || !maxContextTokens || maxContextTokens <= 0 || !replaceItems) return
    const usable = this.compactionTarget(maxContextTokens, compaction.buffer, this.deps.maxOutputTokens)
    let items = this.deps.getItems()
    const opts = this.toLlmOpts()
    // Trust the provider-reported usage when available (mirrors opencode's
    // overflow check): it covers the system prompt + tool definitions, which
    // the transcript char estimate never counts. But it lags behind tool
    // outputs appended after the last response — take the max with a fresh
    // estimate of the current transcript so a big tool result still trips the
    // threshold at the next step boundary instead of being counted late.
    const estimate = estimateUsage(toLlmMessages(items, opts))
    const providerTokens = this.lastTokens
      ? this.lastTokens.total ||
        this.lastTokens.input + this.lastTokens.output +
        (this.lastTokens.cacheRead ?? 0) + (this.lastTokens.cacheWrite ?? 0)
      : 0
    const usedTokens = Math.max(estimate, providerTokens)
    if (usedTokens < usable) return

    // Prune old tool outputs first (cheap) before spending an LLM compact call.
    // The provider-reported count still includes the pruned bytes, so re-check
    // against a fresh estimate of the smaller transcript.
    const pruned = pruneToolOutputs(items, compaction, maxContextTokens)
    if (pruned) {
      replaceItems(items)
      if (estimateUsage(toLlmMessages(items, opts)) < usable) return
    }

    // Phần thân compaction thật, dùng chung cho cả ngưỡng lẫn force-compact.
    await this.compact(signal)
  }

  /**
   * Compact không kiểm tra threshold — provider vừa báo context đã vượt trần
   * thật. Vẫn giữ các fallback (head rỗng / summary fail → hardTruncate) để
   * retry luôn có transcript nhỏ hơn. No-op khi không thể làm gì.
   */
  private async forceCompact(signal?: AbortSignal): Promise<void> {
    const { compaction, replaceItems } = this.deps
    if (!compaction?.auto || !replaceItems) return
    const usable = this.compactionTarget(
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      compaction.buffer,
      this.deps.maxOutputTokens
    )
    const items = this.deps.getItems()
    const pruned = pruneToolOutputs(items, compaction, this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS)
    if (pruned) replaceItems(items)
    await this.compact(signal)
  }

  // Phần thân compaction thật, dùng chung cho cả ngưỡng lẫn force-compact.
  private async compact(signal?: AbortSignal): Promise<void> {
    const { compaction, replaceItems } = this.deps
    if (!compaction?.auto || !replaceItems) return
    const usable = this.compactionTarget(
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      compaction.buffer,
      this.deps.maxOutputTokens
    )
    const items = this.deps.getItems()
    const opts = this.toLlmOpts()
    const measure = (its: TranscriptItem[]) => estimateUsage(toLlmMessages(its, opts))
    const shrink = () => {
      const truncated = hardTruncate(items, usable, measure)
      if (truncated !== items) replaceItems(truncated)
    }

    const { head, tail } = selectHeadTail(items, compaction.keepTokens, compaction.tailTurns)
    if (head.length === 0 || this.compactedThisRun >= MAX_COMPACT_PER_RUN) {
      shrink()
      return
    }
    const previousSummary = this.findPreviousSummary(items)
    const summarizable = fitHeadToBudget(head, usable, compaction.toolOutputMaxChars)
    const prompt = buildCompactionPrompt(previousSummary, serializeItems(summarizable, compaction.toolOutputMaxChars))
    this.deps.onEvent({ type: 'compaction-start', agentId: this.deps.agentId })
    const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
    if (signal?.aborted) return
    if (!summary) {
      this.deps.onEvent({ type: 'compaction-failed', agentId: this.deps.agentId })
      shrink()
      return
    }
    this.compactedThisRun++

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

  /**
   * Một reject của provider có thể tự sửa thay vì giết cả turn:
   * context overflow → force-compact transcript rồi retry step. Chặn bởi
   * MAX_COMPACT_PER_RUN để prompt thật sự quá trần emit lỗi. Caller quản lý
   * `steps--` trước `continue` để retry không tốn step.
   */
  private async tryRecoverFromReject(
    llmMessages: ReturnType<typeof toLlmMessages>,
    message: string | undefined,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (signal?.aborted) return false
    if (this.rejectRetriesThisRun >= MAX_COMPACT_PER_RUN) return false
    if (!classifyContextOverflowError(message)) return false
    this.rejectRetriesThisRun++
    // Trần context thật ≤ cỡ prompt bị reject (hoặc con số provider đích danh).
    this.deps.onContextOverflow?.(estimateUsage(llmMessages), message)
    await this.forceCompact(signal)
    return true
  }

  // Prompt-building options shared by buildMessages and the overflow estimate,
  // so what we measure is exactly what we send. Tool results in the recent tail
  // reach the model at full size; only older ones are capped, which is what
  // lets a `read` or a test run actually be useful to the model.
  private toLlmOpts(): ToLlmOptions {
    return {
      toolOutputMaxChars: this.deps.compaction?.toolOutputMaxChars,
      keepFullTurns: this.deps.compaction?.tailTurns ?? DEFAULT_KEEP_FULL_TURNS,
      ...this.truncationOpts()
    }
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
    const messages = toLlmMessages(this.deps.getItems(), this.toLlmOpts())
    return isLastStep ? [...messages, { role: 'user', content: MAX_STEPS_PROMPT }] : messages
  }
}
