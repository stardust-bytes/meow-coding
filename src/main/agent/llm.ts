import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ModelMessage } from 'ai'
import type { MessageTokens } from '../../shared/types'
import { normalizeToolInput, toToolDefinition } from './message'
import { COMPACTION_MARKER } from './compact'
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
  /** Set on error parts: whether the same request is worth sending again. */
  retryable?: boolean
  /** Set on error parts: the delay the provider asked us to wait. */
  retryAfterMs?: number
  /** Set on error parts: network/API-down — keep retrying past maxAttempts. */
  unbounded?: boolean
}

export interface LlmStreamOptions {
  model: string
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
  variantOptions?: Record<string, unknown>
  /** Upper bound on generated tokens; also what the caller reserved from the context budget. */
  maxOutputTokens?: number
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
// turns (0.1x input price instead of 1.0x). Tag the end of the stable prefix
// (the anchored summary when the session has been compacted, otherwise the first
// message) and the last message, so the cache grows one turn at a time. Other
// providers cache automatically or reject unknown cache_control fields, so they
// are left untouched.
export function withCacheBreakpoints(messages: ModelMessage[], provider: string): ModelMessage[] {
  if (provider !== 'anthropic' || messages.length === 0) return messages
  const tagged = messages.map(m => ({ ...m }))
  const mark = (i: number): void => {
    tagged[i] = { ...tagged[i], providerOptions: { ...tagged[i].providerOptions, ...ANTHROPIC_CACHE_BREAKPOINT } }
  }
  // A compacted transcript opens with the marker plus the summary. Breaking on
  // the marker alone cached a one-line message and threw away the summary, the
  // most valuable stable prefix there is — break after the summary instead.
  mark(summaryEnd(messages))
  const last = tagged.length - 1
  if (last !== 0) mark(last)
  return tagged
}

function summaryEnd(messages: ModelMessage[]): number {
  const first = messages[0]
  const isMarker = first.role === 'user' && typeof first.content === 'string' && first.content === COMPACTION_MARKER
  return isMarker && messages[1]?.role === 'assistant' ? 1 : 0
}

export function createAnthropicLlm(apiKey: string): LlmClient {
  return createLlm('anthropic', apiKey)
}

export function createOpenAICompatibleLlm(opts: { apiKey: string; baseUrl?: string; providerType?: string }): LlmClient {
  return createLlm('openai', opts.apiKey, opts.baseUrl, undefined, opts.providerType)
}

export function createLlm(provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions, providerType?: string): LlmClient {
  const isDeepSeek = provider === 'deepseek' || providerType === 'deepseek' || isDeepSeekEndpoint(baseUrl)
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

  async function* rawStream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
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
      ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
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
          yield { kind: 'error', error: formatLlmError(part.error), ...classifyLlmError(part.error) }
          break
        default:
          break
      }
    }
  }

  return {
    stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      return withRetry(
        (budget) => rawStream(budget === undefined ? opts : { ...opts, maxOutputTokens: budget }),
        { ...retry, signal: opts.signal, reduceBudget: reduceBudgetForMaxTokensError }
      )
    }
  }
}

// Providers reject max_tokens when the catalog overstates the model's real
// output limit (e.g. deepseek-v4-flash lists 1M output but the API caps at
// 64k). The rejection names the real limit; parse it so the retry can send a
// budget the model actually accepts.
const MAX_TOKENS_EXCEEDS_RE = /max_tokens\s*\(\d+\)\s*exceeds\s+model's\s+maximum\s+output\s+tokens\s*\((\d+)\)/i

export function reduceBudgetForMaxTokensError(err: unknown): number | undefined {
  const text = typeof err === 'string'
    ? err
    : (err && typeof err === 'object'
      ? ((err as { responseBody?: string }).responseBody ?? (err as { message?: string }).message ?? '')
      : '')
  const m = MAX_TOKENS_EXCEEDS_RE.exec(text)
  return m ? Number(m[1]) : undefined
}

// Statuses where the identical request can succeed on a later attempt. 4xx
// outside of these is a request the provider will reject just as hard next
// time, so retrying only wastes the user's time. Rate-limit responses get a
// bounded number of attempts; server and socket errors mean the network or the
// API is down, so the turn keeps retrying (like Claude CLI) until it recovers.
const RATE_LIMIT_STATUS = new Set([408, 409, 425, 429])
const SERVER_STATUS = new Set([500, 502, 503, 504, 529])
const RETRYABLE_STATUS = new Set([...RATE_LIMIT_STATUS, ...SERVER_STATUS])
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'
])

export interface LlmErrorClass {
  retryable: boolean
  retryAfterMs?: number
  /** Network/API-down failures: retry with no attempt cap until the service recovers (or the user stops). */
  unbounded?: boolean
}

export function classifyLlmError(err: unknown): LlmErrorClass {
  if (!err || typeof err !== 'object') return { retryable: false }
  const e = err as {
    name?: string
    code?: string
    statusCode?: number
    responseHeaders?: Record<string, string>
    lastError?: unknown
    errors?: unknown[]
  }
  // The SDK's own retry gave up and wrapped the real cause; classify that.
  if (e.name === 'AI_RetryError') {
    const inner = e.lastError ?? e.errors?.[0]
    return inner === undefined ? { retryable: false } : classifyLlmError(inner)
  }
  if (e.name === 'AbortError') return { retryable: false }
  if (typeof e.statusCode === 'number') {
    if (!RETRYABLE_STATUS.has(e.statusCode)) return { retryable: false }
    return {
      retryable: true,
      unbounded: SERVER_STATUS.has(e.statusCode),
      retryAfterMs: retryAfterMs(e.responseHeaders)
    }
  }
  if (e.code && RETRYABLE_CODES.has(e.code)) return { retryable: true, unbounded: true }
  return { retryable: false }
}

function retryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  /** Provider đã đích danh output cap thật khi reject max_tokens — ghi lại để turn sau khỏi lỗi lại. */
  onReducedBudget?: (realLimit: number) => void
  /** Sắp retry sau delayMs — attempt là số attempt sắp chạy (1-based). `unbounded` = đang chờ mạng/API hồi phục, không có cap. */
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; unbounded?: boolean }) => void
}

const DEFAULT_MAX_ATTEMPTS = 10
const DEFAULT_BASE_DELAY_MS = 1000
// Trần cho Retry-After của provider: một header to (60-300s) không được phép
// đóng băng turn im lặng từng đó giây — retry tối đa sau 60s rồi bỏ cuộc.
export const MAX_RETRY_AFTER_MS = 60_000

/**
 * Sleep có thể bị cắt ngang bởi abort: user bấm Stop giữa backoff/Retry-After
 * thì turn phải dừng ngay, không ngủ nốt phần còn lại. Không có signal → chờ
 * đủ ms như setTimeout thường.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise<void>(r => setTimeout(r, ms))
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Re-runs a stream that failed before producing anything. A 429 or a dropped
 * connection used to end the whole turn, losing the work in flight; the AI SDK
 * only retries the initial request, not a failure mid-stream. Once any part has
 * been yielded the attempt is not repeated — replaying would duplicate text the
 * caller already consumed — so the error is surfaced instead.
 *
 * Rate-limit responses retry up to `maxAttempts` (default 10). Network/server
 * failures (`unbounded`) keep retrying past the cap, like Claude CLI, until the
 * connection or the API comes back — the only ways out are success or Stop.
 *
 * A non-retryable rejection can still be recoverable: when the catalog
 * overstates a model's real output limit, the provider rejects max_tokens
 * with a 400. `reduceBudget` reads the real limit from the error and the
 * stream is re-run with a smaller budget instead of failing the whole turn.
 */
export async function* withRetry(
  makeStream: (budget?: number) => AsyncGenerator<LlmStreamPart>,
  opts: RetryOptions & { reduceBudget?: (err: unknown) => number | undefined } = {}
): AsyncGenerator<LlmStreamPart> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const sleep = opts.sleep ?? ((ms: number) => abortableSleep(ms, opts.signal))
  // Delay thật sắp ngủ: Retry-After của provider (nếu có) hoặc backoff nhân
  // đôi, luôn bị chặn ở MAX_RETRY_AFTER_MS.
  const retryDelay = (after: number | undefined, attempt: number): number =>
    Math.min(after ?? backoff(baseDelayMs, attempt), MAX_RETRY_AFTER_MS)
  const scheduleRetry = (after: number | undefined, attempt: number, unbounded?: boolean): Promise<void> => {
    const delayMs = retryDelay(after, attempt)
    opts.onRetry?.({ attempt: attempt + 1, maxAttempts, delayMs, unbounded })
    return sleep(delayMs)
  }

  let budget: number | undefined
  for (let attempt = 1; ; attempt++) {
    let emitted = false
    let failure: LlmStreamPart | undefined
    try {
      for await (const part of makeStream(budget)) {
        if (part.kind === 'error' && !emitted) {
          failure = part
          break
        }
        emitted = true
        yield part
      }
    } catch (err) {
      if (emitted) throw err
      const { retryable, retryAfterMs: after, unbounded } = classifyLlmError(err)
      if (retryable) {
        if (!canRetry(retryable, attempt, maxAttempts, opts.signal, unbounded)) throw err
        await scheduleRetry(after, attempt, unbounded)
        continue
      }
      const reduced = opts.reduceBudget?.(err)
      if (reduced !== undefined && reduced < (budget ?? Number.POSITIVE_INFINITY)) {
        if (!canRetry(true, attempt, maxAttempts, opts.signal)) throw err
        budget = reduced
        opts.onReducedBudget?.(reduced)
        continue
      }
      throw err
    }
    if (!failure) return
    if (failure.retryable === true) {
      if (!canRetry(true, attempt, maxAttempts, opts.signal, failure.unbounded)) { yield failure; return }
      await scheduleRetry(failure.retryAfterMs, attempt, failure.unbounded)
      continue
    }
    const reduced = opts.reduceBudget?.(failure.error)
    if (reduced !== undefined && reduced < (budget ?? Number.POSITIVE_INFINITY)) {
      if (!canRetry(true, attempt, maxAttempts, opts.signal)) { yield failure; return }
      budget = reduced
      opts.onReducedBudget?.(reduced)
      continue
    }
    yield failure
    return
  }
}

function canRetry(retryable: boolean, attempt: number, maxAttempts: number, signal?: AbortSignal, unbounded?: boolean): boolean {
  return retryable && !signal?.aborted && (unbounded === true || attempt < maxAttempts)
}

function backoff(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** (attempt - 1)
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
