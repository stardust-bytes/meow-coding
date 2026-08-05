import type { FlexibleSchema, ModelMessage, Tool } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { ChatMessage, ChatTranscriptItem, ToolCallData } from '../../shared/types'
import { truncateToolOutput } from './compact'
import type { ToolDefinition, ToolSchema } from './tools/types'

export type TranscriptItem = ChatTranscriptItem

type AssistantPart = { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }

export interface ToLlmOptions {
  toolOutputMaxChars?: number
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
          input: call.input ?? {}
        })
      }
      result.push({ role: 'assistant', content })
      pendingAssistant = null
    }
    result.push(...pendingResults)
    pendingResults = []
  }

  const maxOutput = opts?.toolOutputMaxChars

  for (const item of items) {
    if (item.kind === 'message') {
      flush()
      if (item.message.role === 'user') {
        result.push({ role: 'user', content: item.message.text })
      } else {
        pendingAssistant = { text: item.message.text, calls: [] }
      }
    } else {
      if (pendingAssistant) pendingAssistant.calls.push(item.tool)
      const output: { type: 'text'; value: string } | { type: 'error-text'; value: string } =
        item.tool.error
          ? { type: 'error-text', value: item.tool.error }
          : maxOutput !== undefined
            ? { type: 'text', value: truncateToolOutput(item.tool.output ?? 'ok', maxOutput) }
            : { type: 'text', value: item.tool.output ?? 'ok' }
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
