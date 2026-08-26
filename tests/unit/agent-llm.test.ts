import { describe, expect, it, vi, beforeEach } from 'vitest'

const streamTextMock = vi.fn()
const { createOpenAICompatibleMock } = vi.hoisted(() => ({
  createOpenAICompatibleMock: vi.fn()
}))

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  jsonSchema: (s: unknown) => s,
  tool: (t: unknown) => t
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (opts: unknown) => {
    createOpenAICompatibleMock(opts)
    return { chatModel: (modelId: string) => ({ provider: 'mock-openai-compatible', modelId }) }
  }
}))

import { createAnthropicLlm, createLlm, createOpenAICompatibleLlm, formatLlmError, toMessageTokens, withCacheBreakpoints } from '../../src/main/agent/llm'
import type { LlmStreamPart } from '../../src/main/agent/llm'

function fakeFullStream(parts: Array<Record<string, unknown>>) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const p of parts) yield p
    }
  }
}

beforeEach(() => {
  streamTextMock.mockReset()
  createOpenAICompatibleMock.mockReset()
})

describe('createAnthropicLlm', () => {
  it('maps text-delta and finish parts into LlmStreamPart', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([
        { type: 'text-delta', id: '1', text: 'hel' },
        { type: 'text-delta', id: '2', text: 'lo' },
        { type: 'finish', finishReason: 'stop' }
      ])
    })
    const llm = createAnthropicLlm('sk-test')
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({
      model: 'claude-x', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: []
    })) {
      out.push(p)
    }
    expect(out).toEqual([
      { kind: 'text', text: 'hel' },
      { kind: 'text', text: 'lo' },
      { kind: 'finish', finishReason: 'stop' }
    ])
    const call = streamTextMock.mock.calls[0][0]
    expect(call.system).toBe('sys')
    expect(call.abortSignal).toBeUndefined()
  })

  it('maps tool-call parts and passes the abort signal', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: { file_path: 'a.ts' } },
        { type: 'finish', finishReason: 'tool-calls' }
      ])
    })
    const llm = createAnthropicLlm('sk-test')
    const signal = new AbortController().signal
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({
      model: 'claude-x', system: 'sys',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'read', description: 'd', schema: {} as never, run: async () => ({}) }],
      signal
    })) {
      out.push(p)
    }
    expect(out[0]).toEqual({
      kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' }
    })
    const call = streamTextMock.mock.calls[0][0]
    expect(call.abortSignal).toBe(signal)
    expect(call.tools.read).toBeDefined()
  })

  it('maps error parts', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'error', error: new Error('boom') }])
    })
    const llm = createAnthropicLlm('sk-test')
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) {
      out.push(p)
    }
    expect(out).toEqual([{ kind: 'error', error: 'Error: boom', retryable: false }])
  })

  it('maps reasoning deltas and finish tokens', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([
        { type: 'reasoning-delta', id: 'r1', text: 'think ' },
        { type: 'reasoning-delta', id: 'r2', text: 'more' },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      ])
    })
    const llm = createAnthropicLlm('sk-test')
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) {
      out.push(p)
    }
    expect(out[0]).toEqual({ kind: 'reasoning', text: 'think ' })
    expect(out[1]).toEqual({ kind: 'reasoning', text: 'more' })
    expect(out[2]).toEqual({ kind: 'finish', finishReason: 'stop', tokens: { input: 10, output: 5, total: 15 } })
  })

  it('adds anthropic cache breakpoints on the system and first/last messages', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    const llm = createAnthropicLlm('sk-test')
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'user' as const, content: 'mid' },
      { role: 'user' as const, content: 'last' }
    ]
    for await (const p of llm.stream({ model: 'claude-x', system: 'sys', messages, tools: [] })) {
      void p
    }
    const call = streamTextMock.mock.calls[0][0]
    expect(call.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
    expect(call.messages[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
    expect(call.messages[1].providerOptions).toBeUndefined()
    expect(call.messages[2].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  })

  it('adds a single breakpoint when the history has one message and merges variant options', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    const llm = createAnthropicLlm('sk-test')
    const messages = [{ role: 'user' as const, content: 'only' }]
    for await (const p of llm.stream({
      model: 'claude-x', system: 'sys', messages, tools: [],
      variantOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } }
    })) {
      void p
    }
    const call = streamTextMock.mock.calls[0][0]
    expect(call.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
        thinking: { type: 'enabled', budgetTokens: 1024 }
      }
    })
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  })

  it('does not add cache breakpoints for openai-compatible providers', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    const llm = createOpenAICompatibleLlm({ apiKey: 'k', baseUrl: 'http://localhost:11434/v1' })
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'user' as const, content: 'last' }
    ]
    for await (const p of llm.stream({ model: 'llama3', system: 's', messages, tools: [] })) {
      void p
    }
    const call = streamTextMock.mock.calls[0][0]
    expect(call.providerOptions).toBeUndefined()
    expect(call.messages[0].providerOptions).toBeUndefined()
    expect(call.messages[1].providerOptions).toBeUndefined()
  })
})

describe('formatLlmError', () => {
  it('extracts the response body message for an API call error', () => {
    const err = {
      name: 'APICallError',
      statusCode: 401,
      url: 'https://api.deepseek.com/chat/completions',
      responseBody: '{"error":{"message":"Authentication Fails, Your api key is invalid"}}'
    }
    expect(formatLlmError(err)).toBe('Authentication Fails, Your api key is invalid')
  })

  it('falls back to a concise status line when the body is not JSON', () => {
    const err = { name: 'APICallError', statusCode: 429, responseBody: 'rate limited' }
    expect(formatLlmError(err)).toBe('rate limited')
  })

  it('unwraps a RetryError to surface the underlying API error', () => {
    const err = {
      name: 'AI_RetryError',
      lastError: {
        name: 'APICallError',
        statusCode: 401,
        url: 'https://api.deepseek.com/chat/completions',
        responseBody: '{"error":{"message":"Authentication Fails, Your api key is invalid"}}'
      }
    }
    expect(formatLlmError(err)).toBe('Authentication Fails, Your api key is invalid')
  })

  it('reports a 401 with a raw non-JSON body like DeepSeek governance errors', () => {
    const err = {
      name: 'APICallError',
      statusCode: 401,
      url: 'https://api.deepseek.com/chat/completions',
      responseBody: 'Authentication Fails (governor)'
    }
    expect(formatLlmError(err)).toContain('Authentication Fails (governor)')
  })

  it('returns the raw string for plain errors', () => {
    expect(formatLlmError('boom')).toBe('boom')
  })
})

describe('createOpenAICompatibleLlm', () => {
  it('passes baseUrl and apiKey to the provider factory', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    const llm = createOpenAICompatibleLlm({ apiKey: 'k', baseUrl: 'http://localhost:11434/v1' })
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'llama3', system: 's', messages: [], tools: [] })) {
      out.push(p)
    }
    expect(out).toEqual([{ kind: 'finish', finishReason: 'stop' }])
    const opts = createOpenAICompatibleMock.mock.calls[0][0]
    expect(opts.baseURL).toBe('http://localhost:11434/v1')
    expect(opts.apiKey).toBe('k')
    expect(opts.includeUsage).toBeUndefined()
  })

  it('yields a readable error instead of streaming with a non-ASCII API key', async () => {
    const llm = createOpenAICompatibleLlm({ apiKey: 'sk-or-v1-ểabc' })
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'llama3', system: 's', messages: [], tools: [] })) {
      out.push(p)
    }
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('error')
    expect((out[0] as { error?: string }).error).toMatch(/non-ASCII/)
    expect(streamTextMock).not.toHaveBeenCalled()
  })
})

describe('DeepSeek usage capture', () => {
  async function streamOnce(llm: ReturnType<typeof createLlm>) {
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'deepseek-chat', system: 's', messages: [], tools: [] })) {
      out.push(p)
    }
    return out
  }

  it('requests stream usage for the official api.deepseek.com endpoint', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    await streamOnce(createLlm('deepseek', 'k', 'https://api.deepseek.com'))
    const opts = createOpenAICompatibleMock.mock.calls[0][0]
    expect(opts.includeUsage).toBe(true)
    expect(typeof opts.convertUsage).toBe('function')
  })

  it('detects DeepSeek by baseUrl hostname even with a custom provider id', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    await streamOnce(createLlm('my-gateway', 'k', 'https://api.deepseek.com/v1'))
    const opts = createOpenAICompatibleMock.mock.calls[0][0]
    expect(opts.includeUsage).toBe(true)
  })

  it('does not enable stream usage for other OpenAI-compatible endpoints', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    await streamOnce(createLlm('ollama', 'k', 'http://localhost:11434/v1'))
    expect(createOpenAICompatibleMock.mock.calls[0][0].includeUsage).toBeUndefined()
  })

  it('maps prompt_cache_hit_tokens into cacheRead and reasoning tokens', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }])
    })
    await streamOnce(createLlm('deepseek', 'k', 'https://api.deepseek.com'))
    const convert = createOpenAICompatibleMock.mock.calls[0][0].convertUsage
    expect(convert({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 700,
      completion_tokens_details: { reasoning_tokens: 50 }
    })).toEqual({
      inputTokens: { total: 1000, noCache: 300, cacheRead: 700, cacheWrite: undefined },
      outputTokens: { total: 200, text: 150, reasoning: 50 }
    })
  })

  it('surfaces streamed usage as tokens end-to-end', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([
        { type: 'finish', finishReason: 'stop', totalUsage: {
          inputTokens: 1000,
          outputTokens: 200,
          totalTokens: 1200,
          inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 700, cacheWriteTokens: undefined },
          reasoningTokens: 50
        } }
      ])
    })
    const out = await streamOnce(createLlm('deepseek', 'k', 'https://api.deepseek.com'))
    expect(out).toEqual([{ kind: 'finish', finishReason: 'stop', tokens: {
      input: 300, output: 200, total: 1200, reasoning: 50, cacheRead: 700, cacheWrite: undefined
    } }])
  })
})

describe('toMessageTokens', () => {
  it('maps the full AI SDK usage breakdown', () => {
    expect(toMessageTokens({
      inputTokens: 100, outputTokens: 20, totalTokens: 130,
      reasoningTokens: 8, cachedInputTokens: 500
    })).toEqual({ input: 100, output: 20, total: 130, reasoning: 8, cacheRead: 500, cacheWrite: undefined })
  })

  it('maps SDK v6 inputTokenDetails (noCache/cacheRead/cacheWrite) and cache creation', () => {
    expect(toMessageTokens({
      inputTokens: 130, outputTokens: 20, totalTokens: 150,
      cacheCreationInputTokens: 30,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 30 }
    })).toEqual({ input: 100, output: 20, total: 150, reasoning: undefined, cacheRead: 500, cacheWrite: 30 })
  })

  it('defaults missing counters to 0 and leaves optional fields undefined', () => {
    expect(toMessageTokens({})).toEqual({ input: 0, output: 0, total: 0, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined })
  })

  it('returns undefined when the provider reports no usage', () => {
    expect(toMessageTokens(undefined)).toBeUndefined()
  })
})

describe('createLlm retry', () => {
  it('retries a 429 from the provider stream and yields the successful attempt', async () => {
    streamTextMock
      .mockReturnValueOnce({ fullStream: fakeFullStream([{ type: 'error', error: { statusCode: 429, message: 'rate limited' } }]) })
      .mockReturnValueOnce({ fullStream: fakeFullStream([{ type: 'text-delta', id: '1', text: 'ok' }, { type: 'finish', finishReason: 'stop' }]) })
    const llm = createLlm('openai', 'sk-test', undefined, { sleep: async () => {} })
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) out.push(p)
    expect(streamTextMock).toHaveBeenCalledTimes(2)
    expect(out.map(p => p.kind)).toEqual(['text', 'finish'])
  })

  it('does not retry a 401 and surfaces the error once', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'error', error: { statusCode: 401, message: 'bad key' } }])
    })
    const llm = createLlm('openai', 'sk-test', undefined, { sleep: async () => {} })
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) out.push(p)
    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('error')
  })

  it('does not retry the non-ASCII api key guard', async () => {
    const llm = createLlm('openai', 'sk-tęst', undefined, { sleep: async () => {} })
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) out.push(p)
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(out).toHaveLength(1)
    expect(out[0].error).toMatch(/non-ASCII/)
  })
})

describe('output token budget', () => {
  it('passes maxOutputTokens through to streamText', async () => {
    streamTextMock.mockReturnValue({ fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }]) })
    const llm = createLlm('openai', 'sk-test')
    for await (const _ of llm.stream({ model: 'm', system: 's', messages: [], tools: [], maxOutputTokens: 8000 })) { /* drain */ }
    expect((streamTextMock.mock.calls[0][0] as { maxOutputTokens?: number }).maxOutputTokens).toBe(8000)
  })

  it('leaves maxOutputTokens unset when the caller does not ask for one', async () => {
    streamTextMock.mockReturnValue({ fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }]) })
    const llm = createLlm('openai', 'sk-test')
    for await (const _ of llm.stream({ model: 'm', system: 's', messages: [], tools: [] })) { /* drain */ }
    expect((streamTextMock.mock.calls[0][0] as Record<string, unknown>)).not.toHaveProperty('maxOutputTokens')
  })
})

describe('cache breakpoints after compaction', () => {
  const BREAK = { anthropic: { cacheControl: { type: 'ephemeral' } } }

  it('caches through the anchored summary, not just the marker', () => {
    const messages = [
      { role: 'user' as const, content: 'What did we do so far?' },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'the summary' }] },
      { role: 'user' as const, content: 'next question' },
      { role: 'user' as const, content: 'latest' }
    ]
    const out = withCacheBreakpoints(messages, 'anthropic')
    expect(out[1].providerOptions).toEqual(BREAK)
    expect(out[3].providerOptions).toEqual(BREAK)
  })

  it('leaves the plain first/last breakpoints alone without a compaction pair', () => {
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'user' as const, content: 'mid' },
      { role: 'user' as const, content: 'last' }
    ]
    const out = withCacheBreakpoints(messages, 'anthropic')
    expect(out[0].providerOptions).toEqual(BREAK)
    expect(out[1].providerOptions).toBeUndefined()
    expect(out[2].providerOptions).toEqual(BREAK)
  })
})
