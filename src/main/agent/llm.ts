import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import type { MessageTokens } from '../../shared/types'
import { normalizeToolInput, toToolDefinition } from './message'
import type { ToolDefinition } from './tools/types'

export interface LlmStreamPart {
  kind: 'text' | 'reasoning' | 'tool-call' | 'finish' | 'error'
  text?: string
  toolName?: string
  toolCallId?: string
  toolInput?: Record<string, unknown>
  finishReason?: string
  error?: string
  tokens?: MessageTokens
}

export interface LlmStreamOptions {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
  variantOptions?: Record<string, unknown>
}

export interface LlmClient {
  stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart>
}

type StreamProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

interface SdkUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  cacheCreationInputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

export function toMessageTokens(usage: SdkUsage | undefined): MessageTokens | undefined {
  if (!usage) return undefined
  // SDK v6 reports inputTokens as the total prompt size (including cached
  // tokens) and breaks down noCache/cacheRead/cacheWrite in inputTokenDetails.
  // The plain input counter is what's actually billed at full price.
  const details = usage.inputTokenDetails
  return {
    input: details?.noCacheTokens ?? usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    total: usage.totalTokens ?? 0,
    reasoning: usage.reasoningTokens,
    cacheRead: details?.cacheReadTokens ?? usage.cachedInputTokens,
    cacheWrite: details?.cacheWriteTokens ?? usage.cacheCreationInputTokens
  }
}

// DeepSeek's OpenAI-compatible API only reports usage in streams when the
// client sends stream_options.include_usage, and it reports cache hits via
// prompt_cache_hit_tokens (not OpenAI's prompt_tokens_details.cached_tokens).
// Mirror the official @ai-sdk/deepseek provider so streamed usage actually
// arrives and cached prompt tokens are split out for discounted pricing.
function convertDeepSeekUsage(usage: unknown) {
  // Provider streams without a usage chunk call convertUsage(undefined) — same
  // null-shape as the generic converter so counters resolve to 0.
  const u = (usage ?? {}) as {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    prompt_cache_hit_tokens?: number | null
    completion_tokens_details?: { reasoning_tokens?: number | null } | null
  }
  const promptTokens = u.prompt_tokens ?? 0
  const completionTokens = u.completion_tokens ?? 0
  const cacheReadTokens = u.prompt_cache_hit_tokens ?? 0
  const reasoningTokens = u.completion_tokens_details?.reasoning_tokens ?? 0
  return {
    inputTokens: {
      total: promptTokens,
      noCache: promptTokens - cacheReadTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: undefined
    },
    outputTokens: {
      total: completionTokens,
      text: completionTokens - reasoningTokens,
      reasoning: reasoningTokens || undefined
    }
  }
}

function isDeepSeekEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname.endsWith('deepseek.com')
  } catch {
    return false
  }
}

const ANTHROPIC_CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const

// Anthropic needs explicit cache breakpoints to reuse the prompt prefix across
// turns (0.1x input price instead of 1.0x). Tag the first message (long-lived
// stable prefix) and the last message (cache grows one turn at a time), mirroring
// opencode's applyCaching. Other providers cache automatically or reject unknown
// cache_control fields, so they are left untouched.
export function withCacheBreakpoints(messages: ModelMessage[], provider: string): ModelMessage[] {
  if (provider !== 'anthropic' || messages.length === 0) return messages
  const tagged = messages.map(m => ({ ...m }))
  tagged[0] = { ...tagged[0], providerOptions: { ...tagged[0].providerOptions, ...ANTHROPIC_CACHE_BREAKPOINT } }
  const last = tagged.length - 1
  if (last !== 0) {
    tagged[last] = { ...tagged[last], providerOptions: { ...tagged[last].providerOptions, ...ANTHROPIC_CACHE_BREAKPOINT } }
  }
  return tagged
}

export function createAnthropicLlm(apiKey: string): LlmClient {
  return createLlm('anthropic', apiKey)
}

export function createOpenAICompatibleLlm(opts: { apiKey: string; baseUrl?: string }): LlmClient {
  return createLlm('openai', opts.apiKey, opts.baseUrl)
}

export function createLlm(provider: string, apiKey: string, baseUrl?: string): LlmClient {
  const isDeepSeek = provider === 'deepseek' || isDeepSeekEndpoint(baseUrl)
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
      apiKey,
      ...(isDeepSeek
        ? { includeUsage: true, convertUsage: (usage: unknown) => convertDeepSeekUsage(usage) }
        : {})
    }).chatModel(modelId)
  }

  return {
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      // The SDK puts the key into the Authorization header, which undici
      // converts to a ByteString: non-ASCII keys fail with a cryptic
      // "Cannot convert argument to a ByteString" TypeError. Guard keys that
      // were stored before connectProvider validated them (hand-edited
      // meow.json, older vault entries) and surface a readable error instead.
      if (apiKey && !/^[\x21-\x7E]+$/.test(apiKey)) {
        yield { kind: 'error', error: 'Invalid API key: it contains non-ASCII characters. API keys must be ASCII — re-enter the key in Providers.' }
        return
      }
      const tools = Object.fromEntries(opts.tools.map(def => [def.name, toToolDefinition(def)]))
      // Anthropic: top-level cacheControl caches the system prompt (sent on
      // every request); message breakpoints cache the growing history prefix.
      const variant = opts.variantOptions as StreamProviderOptions | undefined
      let providerOptions: StreamProviderOptions | undefined
      if (provider === 'anthropic') {
        providerOptions = {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
            ...(variant?.anthropic as Record<string, unknown> | undefined)
          }
        }
      } else {
        providerOptions = variant
      }
      const result = streamText({
        model: model(opts.model),
        system: opts.system,
        messages: withCacheBreakpoints(opts.messages, provider),
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
              toolInput: normalizeToolInput(part.input)
            }
            break
          case 'finish':
            yield {
              kind: 'finish',
              finishReason: part.finishReason,
              tokens: toMessageTokens(part.totalUsage)
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
