import { describe, expect, it, vi, beforeEach } from 'vitest'

const streamTextMock = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args)
}))

import { createAnthropicLlm, createOpenAICompatibleLlm, formatLlmError } from '../../src/main/agent/llm'
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
