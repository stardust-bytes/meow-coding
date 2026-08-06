import { describe, expect, it, vi, beforeEach } from 'vitest'

const streamTextMock = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  jsonSchema: (s: unknown) => s,
  tool: (t: unknown) => t
}))

import { createAnthropicLlm, createOpenAICompatibleLlm, formatLlmError, toMessageTokens } from '../../src/main/agent/llm'
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
    expect(out).toEqual([{ kind: 'error', error: 'Error: boom' }])
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
  })
})

describe('toMessageTokens', () => {
  it('maps the full AI SDK usage breakdown', () => {
    expect(toMessageTokens({
      inputTokens: 100, outputTokens: 20, totalTokens: 130,
      reasoningTokens: 8, cachedInputTokens: 500
    })).toEqual({ input: 100, output: 20, total: 130, reasoning: 8, cacheRead: 500 })
  })

  it('defaults missing counters to 0 and leaves optional fields undefined', () => {
    expect(toMessageTokens({})).toEqual({ input: 0, output: 0, total: 0, reasoning: undefined, cacheRead: undefined })
  })

  it('returns undefined when the provider reports no usage', () => {
    expect(toMessageTokens(undefined)).toBeUndefined()
  })
})
