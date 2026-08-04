import { randomUUID } from 'node:crypto'
import type { ChatEvent, ChatMessage, PromptResponse, ToolCallData } from '../../shared/types'
import { appendStreamDelta } from '../../shared/text'
import type { LlmClient, LlmStreamPart } from './llm'
import { toLlmMessages } from './message'
import type { TranscriptItem } from './message'
import type { ToolContext, ToolDefinition } from './tools/types'
import type { PermissionDecision } from './permission'

export interface LoopDeps {
  agentId: string
  model: string
  system: string
  cwd: string
  llm: LlmClient
  tools: Map<string, ToolDefinition>
  decidePermission: (toolName: string) => PermissionDecision
  ask: (promptId: string) => Promise<PromptResponse | null>
  maxSteps?: number
  onEvent: (e: ChatEvent) => void
  getItems: () => TranscriptItem[]
  appendMessage: (msg: ChatMessage) => void
  appendTool: (tool: ToolCallData) => void
}

const DEFAULT_MAX_STEPS = 50

export class SessionRunner {
  private readonly maxSteps: number

  constructor(private deps: LoopDeps) {
    this.maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS
  }

  async run(signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
    let steps = 0
    while (true) {
      if (signal?.aborted) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }
      if (steps >= this.maxSteps) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'max-steps' })
        return
      }
      steps++

      const llmMessages = toLlmMessages(this.deps.getItems())
      let hasToolCall = false
      let textBuffer = ''
      const calls: ToolCallData[] = []
      try {
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system: this.deps.system,
          messages: llmMessages,
          tools: [...this.deps.tools.values()],
          signal
        })
        for await (const part of stream) {
          if (signal?.aborted) {
            this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
            return
          }
          if (part.kind === 'text') {
            const next = appendStreamDelta(textBuffer, part.text ?? '')
            const delta = next.slice(textBuffer.length)
            textBuffer = next
            this.deps.onEvent({ type: 'text-delta', agentId, delta })
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
          } else if (part.kind === 'error') {
            this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
            return
          }
        }
      } catch (err) {
        if (signal?.aborted) {
          this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        } else {
          this.deps.onEvent({ type: 'error', agentId, message: String(err) })
        }
        return
      }

      if (signal?.aborted) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }

      this.deps.appendMessage({
        id: randomUUID(),
        role: 'assistant',
        text: textBuffer,
        createdAt: Date.now()
      })

      for (const call of calls) {
        await this.executeCall(call, signal)
      }

      if (!hasToolCall) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'complete' })
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
      const resp = await this.deps.ask(promptId)
      allowed = resp?.allow ?? false
    }

    if (!allowed) {
      call.permission = 'denied'
      call.error = 'permission denied'
    } else {
      call.permission = 'allowed'
      const def = this.deps.tools.get(call.tool)
      if (!def) {
        call.error = `unknown tool: ${call.tool}`
      } else {
        const toolCtx: ToolContext = {
          cwd: this.deps.cwd,
          signal,
          ask: async (question) => {
            const promptId = randomUUID()
            this.deps.onEvent({ type: 'prompt-request', agentId, promptId, kind: 'question', question })
            const resp = await this.deps.ask(promptId)
            return resp?.text ?? null
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
}
