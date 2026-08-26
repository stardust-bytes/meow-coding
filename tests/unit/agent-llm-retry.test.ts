import { describe, expect, it } from 'vitest'
import { classifyLlmError, withRetry } from '../../src/main/agent/llm'
import type { LlmStreamPart } from '../../src/main/agent/llm'

function parts(...p: LlmStreamPart[]) {
  return async function* (): AsyncGenerator<LlmStreamPart> {
    for (const part of p) yield part
  }
}

async function collect(gen: AsyncGenerator<LlmStreamPart>): Promise<LlmStreamPart[]> {
  const out: LlmStreamPart[] = []
  for await (const p of gen) out.push(p)
  return out
}

const noSleep = async () => {}

describe('classifyLlmError', () => {
  it('marks rate limits and server errors as retryable', () => {
    for (const statusCode of [408, 429, 500, 502, 503, 529]) {
      expect(classifyLlmError({ statusCode }).retryable, `status ${statusCode}`).toBe(true)
    }
  })

  it('does not retry client errors that would fail again', () => {
    for (const statusCode of [400, 401, 403, 404, 422]) {
      expect(classifyLlmError({ statusCode }).retryable, `status ${statusCode}`).toBe(false)
    }
  })

  it('reads retry-after seconds from the response headers', () => {
    const c = classifyLlmError({ statusCode: 429, responseHeaders: { 'retry-after': '3' } })
    expect(c.retryable).toBe(true)
    expect(c.retryAfterMs).toBe(3000)
  })

  it('ignores an unparseable retry-after', () => {
    expect(classifyLlmError({ statusCode: 429, responseHeaders: { 'retry-after': 'soon' } }).retryAfterMs).toBeUndefined()
  })

  it('treats a dropped connection as retryable', () => {
    expect(classifyLlmError(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })).retryable).toBe(true)
  })

  it('unwraps AI_RetryError to classify the underlying error', () => {
    expect(classifyLlmError({ name: 'AI_RetryError', lastError: { statusCode: 529 } }).retryable).toBe(true)
    expect(classifyLlmError({ name: 'AI_RetryError', lastError: { statusCode: 401 } }).retryable).toBe(false)
  })

  it('never retries an abort', () => {
    expect(classifyLlmError({ name: 'AbortError' }).retryable).toBe(false)
  })
})

describe('withRetry', () => {
  it('retries a retryable error part and yields the next attempt', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'overloaded', retryable: true })()
        : parts({ kind: 'text', text: 'hello' }, { kind: 'finish' })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep }))
    expect(attempts).toBe(2)
    expect(out.map(p => p.kind)).toEqual(['text', 'finish'])
  })

  it('stops retrying once the stream has already emitted content', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      return parts({ kind: 'text', text: 'partial' }, { kind: 'error', error: 'dropped', retryable: true })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep }))
    expect(attempts).toBe(1)
    expect(out.map(p => p.kind)).toEqual(['text', 'error'])
  })

  it('gives up after maxAttempts and yields the last error', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      return parts({ kind: 'error', error: 'overloaded', retryable: true })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep, maxAttempts: 3 }))
    expect(attempts).toBe(3)
    expect(out).toEqual([{ kind: 'error', error: 'overloaded', retryable: true }])
  })

  it('does not retry a non-retryable error', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      return parts({ kind: 'error', error: 'bad api key', retryable: false })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep }))
    expect(attempts).toBe(1)
    expect(out).toHaveLength(1)
  })

  it('does not retry once the signal is aborted', async () => {
    const controller = new AbortController()
    let attempts = 0
    const make = () => {
      attempts++
      controller.abort()
      return parts({ kind: 'error', error: 'overloaded', retryable: true })()
    }
    await collect(withRetry(make, { sleep: noSleep, signal: controller.signal }))
    expect(attempts).toBe(1)
  })

  it('waits the delay the error asks for before retrying', async () => {
    const waited: number[] = []
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'slow down', retryable: true, retryAfterMs: 4200 })()
        : parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, { sleep: async (ms) => { waited.push(ms) } }))
    expect(waited).toEqual([4200])
  })

  it('backs off exponentially when the error names no delay', async () => {
    const waited: number[] = []
    const make = () => parts({ kind: 'error', error: 'overloaded', retryable: true })()
    await collect(withRetry(make, { sleep: async (ms) => { waited.push(ms) }, maxAttempts: 3, baseDelayMs: 500 }))
    expect(waited).toEqual([500, 1000])
  })

  it('retries a thrown retryable error and rethrows when it will not recover', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      if (attempts === 1) throw Object.assign(new Error('boom'), { statusCode: 503 })
      return parts({ kind: 'finish' })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep }))
    expect(attempts).toBe(2)
    expect(out.map(p => p.kind)).toEqual(['finish'])

    const fatal = () => { throw Object.assign(new Error('nope'), { statusCode: 401 }) }
    await expect(collect(withRetry(fatal, { sleep: noSleep }))).rejects.toThrow('nope')
  })
})
