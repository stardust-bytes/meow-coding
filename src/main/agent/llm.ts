import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import { toToolDefinition } from './message'
import type { ToolDefinition } from './tools/types'
import type { ModelVariant } from '../../shared/types'

export interface LlmStreamPart {
  kind: 'text' | 'reasoning' | 'tool-call' | 'finish' | 'error'
  text?: string
  toolName?: string
  toolCallId?: string
  toolInput?: Record<string, unknown>
  finishReason?: string
  error?: string
  tokens?: { input: number; output: number; total: number }
}

export interface LlmStreamOptions {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
  variant?: string
}

export interface LlmClient {
  stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart>
}

type StreamProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

const ANTHROPIC_THINKING_BUDGET: Record<string, number> = {
  medium: 8192,
  high: 16384,
  max: 32000
}

function providerOptionsFor(provider: string, variant?: string): StreamProviderOptions | undefined {
  if (!variant) return undefined
  if (provider === 'anthropic') {
    const budget = ANTHROPIC_THINKING_BUDGET[variant]
    if (!budget) return undefined
    return {
      anthropic: { thinking: { type: 'enabled', budgetTokens: budget } }
    } as StreamProviderOptions
  }
  if (provider === 'google') {
    return {
      google: { thinkingConfig: { includeThoughts: true, thinkingLevel: variant } }
    } as StreamProviderOptions
  }
  return { openaiCompatible: { reasoningEffort: variant } } as StreamProviderOptions
}

export function createAnthropicLlm(apiKey: string): LlmClient {
  return createLlm('anthropic', apiKey)
}

export function createOpenAICompatibleLlm(opts: { apiKey: string; baseUrl?: string }): LlmClient {
  return createLlm('openai', opts.apiKey, opts.baseUrl)
}

export function createLlm(provider: string, apiKey: string, baseUrl?: string): LlmClient {
  const model = (modelId: string) => {
    if (provider === 'anthropic') {
      const anthropicClient = createAnthropic({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {})
      })
      return anthropicClient(modelId)
    }
    if (provider === 'google') {
      const googleClient = createGoogleGenerativeAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {})
      })
      return googleClient(modelId)
    }
    return createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? 'https://api.openai.com/v1',
      apiKey
    }).chatModel(modelId)
  }

  return {
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      const tools = Object.fromEntries(opts.tools.map(def => [def.name, toToolDefinition(def)]))
      const providerOptions = providerOptionsFor(provider, opts.variant)
      const result = streamText({
        model: model(opts.model),
        system: opts.system,
        messages: opts.messages,
        tools,
        abortSignal: opts.signal,
        ...(providerOptions ? { providerOptions } : {})
      })
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { kind: 'text', text: part.text }
            break
          case 'reasoning-delta':
            yield { kind: 'reasoning', text: part.text }
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
            yield {
              kind: 'finish',
              finishReason: part.finishReason,
              tokens: part.totalUsage
                ? {
                    input: part.totalUsage.inputTokens ?? 0,
                    output: part.totalUsage.outputTokens ?? 0,
                    total: part.totalUsage.totalTokens ?? 0
                  }
                : undefined
            }
            break
          case 'error':
            yield { kind: 'error', error: formatLlmError(part.error) }
            break
          default:
            break
        }
      }
    }
  }
}

export function formatLlmError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; statusCode?: number; url?: string; responseBody?: string; message?: string }
    if (e.name === 'AI_RetryError') {
      const inner = (e as { lastError?: unknown; errors?: unknown[] }).lastError ?? (e as { errors?: unknown[] }).errors?.[0]
      return formatLlmError(inner)
    }
    if (typeof e.statusCode === 'number') {
      let detail = e.message ?? ''
      if (typeof e.responseBody === 'string') {
        try {
          const parsed = JSON.parse(e.responseBody) as { error?: { message?: string } }
          if (parsed?.error?.message) detail = parsed.error.message
        } catch {
          if (!detail && !/^[\[{]/.test(e.responseBody.trim())) detail = e.responseBody.trim()
        }
      }
      const url = e.url ? ` (${e.url})` : ''
      return detail || `${e.name ?? 'API'} error (${e.statusCode})${url}`
    }
    if (e.name === 'AbortError') return 'aborted'
  }
  return String(err)
}
