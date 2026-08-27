import { describe, expect, it } from 'vitest'
import { abortableSleep, classifyLlmError, MAX_RETRY_AFTER_MS, reduceBudgetForMaxTokensError, withRetry } from '../../src/main/agent/llm'
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

describe('reduceBudgetForMaxTokensError', () => {
  it('parses the real output limit from a thrown API error', () => {
    const err = Object.assign(
      new Error('max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
      {
        statusCode: 400,
        responseBody: JSON.stringify({
          error: { message: 'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash' }
        })
      }
    )
    expect(reduceBudgetForMaxTokensError(err)).toBe(65536)
  })

  it('parses the limit from a formatted error string', () => {
    expect(reduceBudgetForMaxTokensError(
      'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'
    )).toBe(65536)
  })

  it('returns undefined for unrelated errors', () => {
    expect(reduceBudgetForMaxTokensError(Object.assign(new Error('bad api key'), { statusCode: 401 }))).toBeUndefined()
    expect(reduceBudgetForMaxTokensError('boom')).toBeUndefined()
    expect(reduceBudgetForMaxTokensError(undefined)).toBeUndefined()
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

  it('re-runs with a reduced budget when max_tokens exceeds the model limit', async () => {
    const budgets: Array<number | undefined> = []
    let attempts = 0
    const make = (budget?: number) => {
      budgets.push(budget)
      attempts++
      if (attempts === 1) {
        throw Object.assign(
          new Error('max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
          {
            statusCode: 400,
            responseBody: JSON.stringify({
              error: { message: 'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash' }
            })
          }
        )
      }
      return parts({ kind: 'finish' })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep, reduceBudget: reduceBudgetForMaxTokensError }))
    expect(attempts).toBe(2)
    expect(budgets).toEqual([undefined, 65536])
    expect(out.map(p => p.kind)).toEqual(['finish'])
  })

  it('reduces the budget for a non-retryable error part too', async () => {
    const budgets: Array<number | undefined> = []
    let attempts = 0
    const make = (budget?: number) => {
      budgets.push(budget)
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash', retryable: false })()
        : parts({ kind: 'finish' })()
    }
    const out = await collect(withRetry(make, { sleep: noSleep, reduceBudget: reduceBudgetForMaxTokensError }))
    expect(attempts).toBe(2)
    expect(budgets).toEqual([undefined, 65536])
    expect(out.map(p => p.kind)).toEqual(['finish'])
  })

  it('does not reduce the budget for other non-retryable errors', async () => {
    let attempts = 0
    const make = () => {
      attempts++
      throw Object.assign(new Error('bad api key'), { statusCode: 401 })
    }
    await expect(collect(withRetry(make, { sleep: noSleep, reduceBudget: reduceBudgetForMaxTokensError }))).rejects.toThrow('bad api key')
    expect(attempts).toBe(1)
  })

  it('gives up when the reduced budget still exceeds the model limit', async () => {
    let attempts = 0
    const make = (budget?: number) => {
      attempts++
      // The error always names the same limit, so the budget never shrinks
      // below it and the retry must stop rather than loop forever.
      throw Object.assign(
        new Error('max_tokens (65536) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
        { statusCode: 400 }
      )
    }
    await expect(collect(withRetry(make, { sleep: noSleep, maxAttempts: 3, reduceBudget: reduceBudgetForMaxTokensError })))
      .rejects.toThrow('max_tokens')
    // First attempt reduces the budget to 65536; the second sees no further
    // reduction possible and rethrows.
    expect(attempts).toBe(2)
  })

  it('fires onReducedBudget when a max_tokens rejection is parsed (thrown branch)', async () => {
    const realLimits: number[] = []
    let attempts = 0
    const make = (budget?: number) => {
      attempts++
      if (attempts === 1) {
        throw Object.assign(
          new Error('max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
          { statusCode: 400 }
        )
      }
      return parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))
    expect(realLimits).toEqual([65536])
  })

  it('fires onReducedBudget from the error-part branch too', async () => {
    const realLimits: number[] = []
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash', retryable: false })()
        : parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))
    expect(realLimits).toEqual([65536])
  })

  it('does not fire onReducedBudget when nothing is parsed', async () => {
    const realLimits: number[] = []
    const make = () => { throw Object.assign(new Error('bad api key'), { statusCode: 401 }) }
    await expect(collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onReducedBudget: (n) => realLimits.push(n)
    }))).rejects.toThrow('bad api key')
    expect(realLimits).toEqual([])
  })

  it('fires onRetry before each retry with the upcoming attempt and delay', async () => {
    const retries: Array<{ attempt: number; maxAttempts: number; delayMs: number }> = []
    const waited: number[] = []
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'overloaded', retryable: true })()
        : parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: async (ms) => { waited.push(ms) },
      maxAttempts: 3,
      baseDelayMs: 500,
      onRetry: (info) => retries.push(info)
    }))
    expect(retries).toEqual([{ attempt: 2, maxAttempts: 3, delayMs: 500 }])
    expect(waited).toEqual([500])
  })

  it('caps a huge retry-after to MAX_RETRY_AFTER_MS', async () => {
    const waited: number[] = []
    const retries: Array<{ attempt: number; maxAttempts: number; delayMs: number }> = []
    let attempts = 0
    const make = () => {
      attempts++
      return attempts === 1
        ? parts({ kind: 'error', error: 'slow down', retryable: true, retryAfterMs: 120000 })()
        : parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: async (ms) => { waited.push(ms) },
      onRetry: (info) => retries.push(info)
    }))
    expect(waited).toEqual([MAX_RETRY_AFTER_MS])
    expect(retries).toEqual([{ attempt: 2, maxAttempts: 3, delayMs: MAX_RETRY_AFTER_MS }])
  })

  it('does not fire onRetry for a budget-reduction retry (no delay)', async () => {
    const retries: unknown[] = []
    let attempts = 0
    const make = (budget?: number) => {
      attempts++
      if (attempts === 1) {
        throw Object.assign(
          new Error('max_tokens (131072) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash'),
          { statusCode: 400 }
        )
      }
      return parts({ kind: 'finish' })()
    }
    await collect(withRetry(make, {
      sleep: noSleep,
      reduceBudget: reduceBudgetForMaxTokensError,
      onRetry: (info) => retries.push(info)
    }))
    expect(retries).toEqual([])
  })

  it('interrupts the retry backoff when the signal aborts mid-wait (default sleep)', async () => {
    const controller = new AbortController()
    let attempts = 0
    const make = () => {
      attempts++
      return parts({ kind: 'error', error: 'overloaded', retryable: true })()
    }
    const start = Date.now()
    const pending = collect(withRetry(make, { signal: controller.signal, baseDelayMs: 1000 }))
    setTimeout(() => controller.abort(), 20)
    const out = await pending
    expect(Date.now() - start).toBeLessThan(500)
    expect(attempts).toBe(2)
    expect(out).toEqual([{ kind: 'error', error: 'overloaded', retryable: true }])
  })
})

describe('abortableSleep', () => {
  it('resolves promptly when the signal aborts mid-wait', async () => {
    const controller = new AbortController()
    const start = Date.now()
    const pending = abortableSleep(1000, controller.signal)
    setTimeout(() => controller.abort(), 20)
    await pending
    expect(Date.now() - start).toBeLessThan(200)
  })

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const start = Date.now()
    await abortableSleep(1000, controller.signal)
    expect(Date.now() - start).toBeLessThan(50)
  })

  it('waits the full duration without a signal', async () => {
    const start = Date.now()
    await abortableSleep(30)
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})
