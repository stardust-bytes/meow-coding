import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import { toToolDefinition } from './message'
import type { ToolDefinition } from './tools/types'

export interface LlmStreamPart {
  kind: 'text' | 'tool-call' | 'finish' | 'error'
  text?: string
  toolName?: string
  toolCallId?: string
  toolInput?: Record<string, unknown>
  finishReason?: string
  error?: string
}

export interface LlmStreamOptions {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
}

export interface LlmClient {
  stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart>
}

export function createAnthropicLlm(apiKey: string): LlmClient {
  return createLlm('anthropic', apiKey)
}

export function createOpenAICompatibleLlm(opts: { apiKey: string; baseUrl?: string }): LlmClient {
  return createLlm('openai', opts.apiKey, opts.baseUrl)
}

export function createLlm(provider: string, apiKey: string, baseUrl?: string): LlmClient {
  const model = (modelId: string) => {
    if (provider === 'anthropic') return anthropic(modelId)
    return createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? 'https://api.openai.com/v1',
      apiKey
    }).chatModel(modelId)
  }

  return {
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      const tools = Object.fromEntries(opts.tools.map(def => [def.name, toToolDefinition(def)]))
      const result = streamText({
        model: model(opts.model),
        system: opts.system,
        messages: opts.messages,
        tools,
        abortSignal: opts.signal
      })
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { kind: 'text', text: part.text }
            break
          case 'tool-call':
            yield {
              kind: 'tool-call',
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              toolInput: part.input as Record<string, unknown>
            }
            break
          case 'finish':
            yield { kind: 'finish', finishReason: part.finishReason }
            break
          case 'error':
            yield { kind: 'error', error: String(part.error) }
            break
          default:
            break
        }
      }
    }
  }
}
