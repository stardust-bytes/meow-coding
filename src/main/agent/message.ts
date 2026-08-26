import type { FlexibleSchema, ModelMessage, Tool } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { ChatMessage, ChatTranscriptItem, ToolCallData } from '../../shared/types'
import { COMPACTION_MARKER, truncateToolOutput } from './compact'
import type { ToolDefinition, ToolSchema } from './tools/types'

export type TranscriptItem = ChatTranscriptItem

type AssistantPart = { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }

export interface ToLlmOptions {
  toolOutputMaxChars?: number
  /**
   * Tool results in the last N user turns are exempt from `toolOutputMaxChars`
   * and reach the model at full size (still subject to `truncate`). Older
   * results stay capped, which is what keeps a long session inside its budget.
   * Defaults to 0 — every result capped — so callers opt into keeping context.
   */
  keepFullTurns?: number
  truncate?: (toolId: string, text: string) => string
}

// Index of the first item belonging to the last `keepFullTurns` user turns.
// Compaction markers are not real turns, mirroring `turns()` in compact.ts.
function recentTurnStart(items: TranscriptItem[], keepFullTurns: number): number {
  if (keepFullTurns <= 0) return items.length
  let seen = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind !== 'message' || item.message.role !== 'user') continue
    if (item.message.text === COMPACTION_MARKER) continue
    if (++seen === keepFullTurns) return i
  }
  return 0
}

// OpenAI-compatible providers stream `function.arguments` as a raw JSON string;
// the AI SDK only parses it into an object when the JSON is valid. Malformed or
// empty arguments (common with DeepSeek streaming) come through as a string with
// invalid=true. Replaying that string makes the request serializer JSON.stringify
// it again → double-encoded arguments → provider error 2013 "invalid function
// arguments json string". Normalize to a plain object so replay (e.g. the first
// turn after a model switch) always sends valid JSON object arguments.
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // malformed JSON — fall back to empty args instead of double-encoding
    }
  }
  return {}
}

export function toLlmMessages(items: TranscriptItem[], opts?: ToLlmOptions): ModelMessage[] {
  const result: ModelMessage[] = []
  let pendingAssistant: { text: string; calls: ToolCallData[] } | null = null
  let pendingResults: ModelMessage[] = []

  const flush = () => {
    if (pendingAssistant) {
      const content: AssistantPart[] = []
      if (pendingAssistant.text) content.push({ type: 'text', text: pendingAssistant.text })
      for (const call of pendingAssistant.calls) {
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.tool,
          input: normalizeToolInput(call.input)
        })
      }
      result.push({ role: 'assistant', content })
      pendingAssistant = null
    }
    result.push(...pendingResults)
    pendingResults = []
  }

  const maxOutput = opts?.toolOutputMaxChars
  const truncate = opts?.truncate
  const fullFrom = recentTurnStart(items, opts?.keepFullTurns ?? 0)

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (item.kind === 'message') {
      flush()
      if (item.message.role === 'user') {
        const images = item.message.images ?? []
        if (images.length === 0) {
          result.push({ role: 'user', content: item.message.text })
        } else {
          result.push({
            role: 'user',
            content: [
              { type: 'text', text: item.message.text },
              ...images.map(img => ({ type: 'image' as const, image: img.dataUrl }))
            ]
          })
        }
      } else {
        pendingAssistant = { text: item.message.text, calls: [] }
      }
    } else {
      // A tool item must follow the assistant message that made the call. An
      // orphan tool item (e.g. an aborted tool appended after the next turn's
      // user message) would serialize as a "tool" message with no preceding
      // assistant tool_calls, which providers reject with a 400 — drop it so
      // the conversation stays replayable.
      if (!pendingAssistant) continue
      pendingAssistant.calls.push(item.tool)
      let value = item.tool.output ?? 'ok'
      if (maxOutput !== undefined && index < fullFrom) value = truncateToolOutput(value, maxOutput)
      if (truncate) value = truncate(item.tool.id, value)
      const output: { type: 'text'; value: string } | { type: 'error-text'; value: string } =
        item.tool.error
          ? { type: 'error-text', value: item.tool.error }
          : { type: 'text', value }
      pendingResults.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: item.tool.id,
          toolName: item.tool.tool,
          output
        }]
      })
    }
  }
  flush()
  return result
}

export function toToolDefinition(def: ToolDefinition): Tool {
  return {
    description: def.description,
    inputSchema: toInputSchema(def.schema),
    execute: async () => ({ ok: true })
  }
}

function toInputSchema(schema: ToolSchema): FlexibleSchema<any> {
  if (typeof schema.parse === 'function') return schema as FlexibleSchema<any>
  return jsonSchema(schema as Record<string, unknown>)
}
