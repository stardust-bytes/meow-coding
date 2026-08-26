import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionRunner } from '../../src/main/agent/loop'
import type { LoopDeps } from '../../src/main/agent/loop'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { ToolDefinition } from '../../src/main/agent/tools/types'
import type { TranscriptItem } from '../../src/main/agent/message'
import type { ChatEvent, ChatMessage, ToolCallData } from '../../src/shared/types'

class StubLlm implements LlmClient {
  queue: LlmStreamPart[][] = []
  calls: LlmStreamOptions[] = []

  async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
    this.calls.push(opts)
    const parts = this.queue.shift() ?? [
      { kind: 'tool-call' as const, toolCallId: 'tc-auto', toolName: 'todowrite', toolInput: { todos: [] } },
      { kind: 'finish' as const }
    ]
    for (const p of parts) yield p
  }
}

function stubTool(name: string, run?: ToolDefinition['run']): ToolDefinition {
  return {
    name,
    description: name,
    schema: { parse: () => ({}) } as never,
    run: run ?? (async () => ({ output: `${name} ran` }))
  }
}

interface Harness {
  runner: SessionRunner
  events: ChatEvent[]
  items: TranscriptItem[]
  llm: StubLlm
  ask: ReturnType<typeof vi.fn>
  decide: ReturnType<typeof vi.fn>
  appended: { messages: number; tools: number }
}

function makeHarness(overrides: Partial<LoopDeps> = {}): Harness {
  const llm = new StubLlm()
  const items: TranscriptItem[] = []
  const events: ChatEvent[] = []
  const appended = { messages: 0, tools: 0 }
  const ask = vi.fn(async () => null)
  const decide = vi.fn(() => 'allow' as const)
  const deps: LoopDeps = {
    agentId: 'a1',
    model: 'test-model',
    system: 'You are a test agent.',
    cwd: '/proj',
    llm,
    tools: new Map<string, ToolDefinition>(),
    decidePermission: decide,
    ask,
    maxSteps: 10,
    onEvent: (e) => events.push(e),
    getItems: () => items,
    appendMessage: (m: ChatMessage) => {
      items.push({ kind: 'message', message: m })
      appended.messages++
    },
    appendTool: (t: ToolCallData) => {
      items.push({ kind: 'tool', tool: t })
      appended.tools++
    },
    ...overrides
  }
  return { runner: new SessionRunner(deps), events, items, llm, ask, decide, appended }
}

function textParts(...texts: string[]): LlmStreamPart[] {
  return [...texts.map(t => ({ kind: 'text' as const, text: t })), { kind: 'finish' as const }]
}

describe('SessionRunner', () => {
  it('streams a text-only turn and finishes complete', async () => {
    const h = makeHarness()
    h.llm.queue = [textParts('hel', 'lo')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    expect(h.events.map(e => e.type)).toEqual(['text-delta', 'text-delta', 'done'])
    expect(h.events[2]).toEqual({ type: 'done', agentId: 'a1', reason: 'complete' })
    expect(h.appended.messages).toBe(1)
    expect(h.items[0].kind === 'message' && h.items[0].message.role).toBe('assistant')
  })

  it('executes a tool call and feeds its result back to the model', async () => {
    const runSpy = vi.fn(async () => ({ output: 'file content' }))
    const h = makeHarness({
      tools: new Map([['read', stubTool('read', runSpy)]])
    })
    h.llm.queue = [
      [
        { kind: 'text', text: 'reading...' },
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    const types = h.events.map(e => e.type)
    expect(types).toContain('tool-start')
    expect(types).toContain('tool-result')
    expect(runSpy).toHaveBeenCalledWith({ file_path: 'a.ts' }, expect.anything())

    const secondMessages = h.llm.calls[1]?.messages ?? []
    const toolMsg = secondMessages.find(m => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(JSON.stringify(toolMsg)).toContain('file content')
  })

  it('denies tool execution when permission is denied', async () => {
    const runSpy = vi.fn(async () => ({ output: 'x' }))
    const h = makeHarness({
      tools: new Map([['bash', stubTool('bash', runSpy)]]),
      decidePermission: () => 'deny'
    })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'rm -rf' } }, { kind: 'finish' }],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(runSpy).not.toHaveBeenCalled()
    const resultEvent = h.events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(resultEvent.call.error).toMatch(/not permitted/)
    expect(resultEvent.call.permission).toBe('denied')
  })

  it('emits a prompt-request and runs the tool when the user allows it', async () => {
    const runSpy = vi.fn(async () => ({ output: 'ran' }))
    const h = makeHarness({
      tools: new Map([['read', stubTool('read', runSpy)]]),
      decidePermission: () => 'ask',
      ask: vi.fn(async () => ({ allow: true }))
    })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } }, { kind: 'finish' }],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    const promptEvt = h.events.find(e => e.type === 'prompt-request') as Extract<ChatEvent, { type: 'prompt-request' }>
    expect(promptEvt.kind).toBe('permission')
    expect(promptEvt.call?.tool).toBe('read')
    expect(runSpy).toHaveBeenCalled()
  })

  it('stops after maxSteps when the model keeps calling tools', async () => {
    const h = makeHarness({
      tools: new Map([['todowrite', stubTool('todowrite')]]),
      maxSteps: 2
    })
    h.llm.queue = []
    h.runner.run()
    await new Promise(r => setTimeout(r, 50))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('max-steps')
    expect(h.llm.calls.length).toBe(2)
  })

  it('emits done stopped when the signal is already aborted', async () => {
    const h = makeHarness()
    const controller = new AbortController()
    controller.abort()
    h.runner.run(controller.signal)
    await new Promise(r => setTimeout(r, 10))
    expect(h.events).toEqual([{ type: 'done', agentId: 'a1', reason: 'stopped' }])
    expect(h.llm.calls.length).toBe(0)
  })

  it('persists partial assistant text when stopped mid-stream', async () => {
    const h = makeHarness({
      llm: {
        async *stream(opts: { signal?: AbortSignal }) {
          yield { kind: 'text', text: 'partial ' }
          yield { kind: 'text', text: 'answer' }
          await new Promise<void>(resolve => {
            if (opts.signal?.aborted) return resolve()
            opts.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          yield { kind: 'finish' }
        }
      } as LlmClient
    })
    const controller = new AbortController()
    const runPromise = h.runner.run(controller.signal)
    await new Promise(r => setTimeout(r, 30))
    controller.abort()
    await runPromise
    const assistant = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .find(m => m.role === 'assistant')
    expect(assistant?.text).toBe('partial answer')
    expect(h.events.some(e => e.type === 'done' && e.reason === 'stopped')).toBe(true)
  })

  it('surfaces an llm error event', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'error', error: 'rate limited' }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    expect(h.events).toEqual([{ type: 'error', agentId: 'a1', message: 'rate limited' }])
  })

  it('does not append an empty assistant message for a no-op turn', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'finish' }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const assistantCount = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .filter(i => i.message.role === 'assistant').length
    expect(assistantCount).toBe(0)
    expect(h.events.some(e => e.type === 'done')).toBe(true)
  })

  it('streams reasoning and persists it on the assistant message', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'reasoning', text: 'let me think' }, ...textParts('answer')]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    expect(h.events.some(e => e.type === 'reasoning-delta')).toBe(true)
    const assistant = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .find(m => m.role === 'assistant')
    expect(assistant?.text).toBe('answer')
    expect(assistant?.reasoning).toBe('let me think')
  })

  it('reports token usage in the done event', async () => {
    const h = makeHarness()
    h.llm.queue = [[textParts('hi'), { kind: 'finish', tokens: { input: 3, output: 4, total: 7 } }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.tokens).toEqual({ input: 3, output: 4, total: 7 })
  })

  it('disables tools and appends a final-step notice on the last step', async () => {
    const h = makeHarness({ maxSteps: 2 })
    h.llm.queue = []
    h.runner.run()
    await new Promise(r => setTimeout(r, 50))
    expect(h.llm.calls).toHaveLength(2)
    const lastCall = h.llm.calls[1]
    expect(lastCall.tools).toHaveLength(0)
    const userTexts = lastCall.messages
      .filter((m): m is { role: 'user'; content: string } => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content)
    expect(userTexts.some(t => /Final step/.test(t))).toBe(true)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('max-steps')
  })

  it('hides denied tools from the model like opencode visibleTools', async () => {
    const h = makeHarness({
      tools: new Map([
        ['read', stubTool('read')],
        ['write', stubTool('write')],
        ['edit', stubTool('edit')]
      ]),
      decidePermission: (tool) => (tool === 'write' || tool === 'edit' ? 'deny' : 'allow')
    })
    h.llm.queue = [textParts('ok')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const names = h.llm.calls[0]?.tools.map(t => t.name) ?? []
    expect(names).toEqual(['read'])
  })

  it('asks the user through the question tool and feeds the answer back', async () => {
    const h = makeHarness({
      tools: new Map([['question', stubTool('question', async (_i, ctx) => {
        const answer = await ctx.ask('confirm?')
        return answer ? { output: `got: ${answer}` } : { error: 'no answer' }
      })]])
    })
    h.ask.mockImplementation(async () => ({ allow: true, text: 'yes' }))
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'question', toolInput: { question: 'confirm?' } }, { kind: 'finish' }],
      textParts('thanks')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const promptEvt = h.events.find(e => e.type === 'prompt-request') as Extract<ChatEvent, { type: 'prompt-request' }>
    expect(promptEvt.kind).toBe('question')
    const resultEvent = h.events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(resultEvent.call.output).toBe('got: yes')
  })

  it('does not loop re-reading a large plan', async () => {
    // A model that re-reads the plan whenever its content vanished from context
    // would loop forever. The read result must survive in context.
    const planContent = 'PLAN_' + 'x'.repeat(50000)
    const planTool = stubTool('read', async () => ({ output: planContent }))
    const seenPlan = () => JSON.stringify(h.llm.calls.at(-1)?.messages ?? []).includes('PLAN_')

    const h = makeHarness({
      tools: new Map([['read', planTool]]),
      maxSteps: 8,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          const hasPlan = JSON.stringify(opts.messages).includes('PLAN_')
          if (!hasPlan) {
            yield { kind: 'tool-call', toolCallId: 'tc-read', toolName: 'read', toolInput: { file_path: 'plan.md' } }
          } else {
            yield { kind: 'text', text: 'done' }
          }
          yield { kind: 'finish' }
        }
      } as unknown as LlmClient
    })
    h.items.push({
      kind: 'message',
      message: { id: 'u', role: 'user', text: 'read the plan and implement it', createdAt: 1 }
    })

    h.runner.run()
    await new Promise(r => setTimeout(r, 60))

    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done).toBeDefined()
    expect(done.reason).toBe('complete')
    expect(seenPlan()).toBe(true)
  })

  it('keeps a plan read across multiple paged chunks in context', async () => {
    // A 48KB plan read in 20KB chunks (read tool caps output) must not lose the
    // earlier chunks, otherwise the model re-reads chunk 1 forever.
    const planChunks = {
      0: 'CHUNK_A_' + 'a'.repeat(19000),
      1: 'CHUNK_B_' + 'b'.repeat(19000),
      2: 'CHUNK_C_' + 'c'.repeat(19000)
    }
    const planTool = stubTool('read', async (input) => ({
      output: planChunks[String((input as { offset?: number }).offset ?? 0)] ?? 'CHUNK_UNKNOWN'
    }))
    const readOffsets: number[] = []

    const h = makeHarness({
      tools: new Map([['read', planTool]]),
      maxSteps: 12,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          const msgs = JSON.stringify(opts.messages)
          if (msgs.includes('CHUNK_A_') && msgs.includes('CHUNK_B_') && msgs.includes('CHUNK_C_')) {
            yield { kind: 'text', text: 'done' }
          } else {
            // Model pages through the plan: next missing chunk.
            const offset = msgs.includes('CHUNK_A_') ? (msgs.includes('CHUNK_B_') ? 2 : 1) : 0
            readOffsets.push(offset)
            yield { kind: 'tool-call', toolCallId: 'tc-read', toolName: 'read', toolInput: { file_path: 'plan.md', offset } }
          }
          yield { kind: 'finish' }
        }
      } as unknown as LlmClient
    })
    h.items.push({
      kind: 'message',
      message: { id: 'u', role: 'user', text: 'read the plan and implement it', createdAt: 1 }
    })

    h.runner.run()
    await new Promise(r => setTimeout(r, 80))

    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done).toBeDefined()
    expect(done.reason).toBe('complete')
    // Three chunks read once each; a loop would re-read offset 0 repeatedly.
    expect(readOffsets).toEqual([0, 1, 2])
  })

  it('runs an LLM compaction when the transcript exceeds the token budget', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map<string, ToolDefinition>(),
      maxContextTokens: 200,
      compaction: { auto: true, buffer: 20, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000 },
      replaceItems: (items) => replaced.push(items),
      maxSteps: 1,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          if (opts.tools.length === 0) {
            // compaction call
            yield { kind: 'text', text: '## Objective\n- compacted' }
            yield { kind: 'finish' }
          } else {
            yield { kind: 'text', text: 'ok' }
            yield { kind: 'finish' }
          }
        }
      } as unknown as LlmClient
    })
    h.items.push({ kind: 'message', message: { id: 'old', role: 'user', text: 'old '.repeat(5000), createdAt: 1 } })
    h.items.push({ kind: 'message', message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 } })
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(replaced.length).toBe(1)
    const items = replaced[0]
    const texts = items.filter(i => i.kind === 'message').map(i => i.message.text)
    expect(texts[0]).toBe('What did we do so far?')
    expect(texts[1]).toBe('## Objective\n- compacted')
    expect(texts).toContain('latest prompt')
    expect(h.events.some(e => e.type === 'compacted')).toBe(true)
  })

  it('compacts based on the model-reported token usage from the previous turn', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map([['read', stubTool('read')]]),
      maxContextTokens: 200,
      compaction: { auto: true, buffer: 20, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000 },
      replaceItems: (items) => replaced.push(items),
      maxSteps: 2,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          if (opts.tools.length === 0) {
            yield { kind: 'text', text: '## Objective\n- compacted' }
            yield { kind: 'finish' }
          } else if (h.llm.calls.length === 1) {
            yield { kind: 'text', text: 'ok' }
            yield { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } }
            // Real usage from the provider (includes system prompt + tool
            // definitions, which the transcript char estimate never sees).
            yield { kind: 'finish', tokens: { input: 480, output: 20, total: 500 } }
          } else {
            yield { kind: 'text', text: 'done' }
            yield { kind: 'finish' }
          }
        }
      } as unknown as LlmClient
    })
    // Tiny transcript — the chars/4 estimate alone stays far below the budget.
    h.items.push({ kind: 'message', message: { id: 'old', role: 'user', text: 'some earlier prompt', createdAt: 1 } })
    h.items.push({ kind: 'message', message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 } })
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(replaced.length).toBe(1)
    expect(h.events.some(e => e.type === 'compacted')).toBe(true)
  })

  it('compacts when a tool output appended since the last provider usage trips the budget', async () => {
    // Provider reports 320 tokens (below the 480 usable budget), but the tool
    // result appended after that response is huge. The threshold check must not
    // trust the stale provider count alone — the transcript estimate trips it.
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map([['read', stubTool('read', async () => ({ output: 'x'.repeat(5000) }))]]),
      maxContextTokens: 500,
      compaction: { auto: true, buffer: 20, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000 },
      replaceItems: (items) => replaced.push(items),
      maxSteps: 5,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          if (opts.tools.length === 0) {
            // compaction call
            yield { kind: 'text', text: '## Objective\n- compacted' }
            yield { kind: 'finish' }
          } else if (h.llm.calls.length === 1) {
            yield { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } }
            yield { kind: 'finish', tokens: { input: 300, output: 20, total: 320 } }
          } else {
            yield { kind: 'text', text: 'done' }
            yield { kind: 'finish' }
          }
        }
      } as unknown as LlmClient
    })
    h.items.push({ kind: 'message', message: { id: 'old', role: 'user', text: 'some earlier prompt', createdAt: 1 } })
    h.items.push({ kind: 'message', message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 } })
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(replaced.length).toBe(1)
    const events = h.events.map(e => e.type)
    expect(events.indexOf('compaction-start')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('compacted')).toBeGreaterThan(events.indexOf('compaction-start'))
  })

  it('emits compaction-start before the summary and compaction-failed when the call fails', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map<string, ToolDefinition>(),
      maxContextTokens: 200,
      compaction: { auto: true, buffer: 20, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000 },
      maxSteps: 1,
      replaceItems: (items) => replaced.push(items),
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          if (h.llm.calls.length === 1) {
            // compaction call
            yield { kind: 'error', error: 'summary failed' }
          } else {
            yield { kind: 'text', text: 'ok' }
            yield { kind: 'finish' }
          }
        }
      } as unknown as LlmClient
    })
    h.items.push({ kind: 'message', message: { id: 'old', role: 'user', text: 'old '.repeat(5000), createdAt: 1 } })
    h.items.push({ kind: 'message', message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 } })
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    // The failed summary must still leave the context under the limit: the
    // fallback hard-truncate runs so the next request is not rejected.
    expect(replaced.length).toBe(1)
    expect(replaced[0].some(i => i.kind === 'message' && i.message.text.startsWith('old '))).toBe(false)
    const events = h.events.map(e => e.type)
    expect(events.indexOf('compaction-start')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('compaction-failed')).toBeGreaterThan(events.indexOf('compaction-start'))
    expect(events).not.toContain('compacted')
  })

  it('sends the freshest tool output to the model in full', async () => {
    const h = makeHarness({
      tools: new Map([['bash', stubTool('bash', async () => ({ output: 'o'.repeat(5000) }))]]),
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 50 },
      maxContextTokens: 200000
    })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'x' } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const secondMessages = h.llm.calls[1]?.messages ?? []
    const toolMsg = secondMessages.find(m => m.role === 'tool')
    expect(JSON.stringify(toolMsg)).not.toContain('[truncated]')
    expect(JSON.stringify(toolMsg)).toContain('o'.repeat(5000))
  })

  it('truncates tool output from older turns when sending to the model', async () => {
    const h = makeHarness({
      tools: new Map([['bash', stubTool('bash', async () => ({ output: 'n'.repeat(5000) }))]]),
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 1, toolOutputMaxChars: 50 },
      maxContextTokens: 200000
    })
    h.items.push(
      { kind: 'message', message: { id: 'u1', role: 'user', text: 'old question', createdAt: 1 } },
      { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'working', createdAt: 1 } },
      { kind: 'tool', tool: { id: 'old1', tool: 'bash', input: { command: 'old' }, permission: 'allowed', output: 'O'.repeat(5000) } },
      { kind: 'message', message: { id: 'u2', role: 'user', text: 'new question', createdAt: 1 } }
    )
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'x' } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const secondMessages = h.llm.calls[1]?.messages ?? []
    const toolMsgs = secondMessages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect(JSON.stringify(toolMsgs[0])).toContain('[truncated]')
    expect(JSON.stringify(toolMsgs[0])).not.toContain('O'.repeat(5000))
    expect(JSON.stringify(toolMsgs[1])).toContain('n'.repeat(5000))
  })

  it('persists provider token usage on the assistant message', async () => {
    const h = makeHarness()
    h.llm.queue = [[
      { kind: 'text', text: 'hi' },
      { kind: 'finish', tokens: { input: 100, output: 20, total: 130, cacheRead: 500 } }
    ]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))

    const msg = h.items.find(i => i.kind === 'message')
    expect(msg?.kind === 'message' && msg.message.tokens).toEqual({
      input: 100, output: 20, total: 130, cacheRead: 500
    })
  })

  it('persists tokens when aborted right after the finish part arrives', async () => {
    // Race: user clicks Stop just as the stream's final `finish` part lands.
    // The for-await loop has already processed `finish` (tokens assigned,
    // onUsage fired) but hasn't reached the normal appendMessage call yet —
    // it exits through the post-loop `signal.aborted` check and persistPartial()
    // instead. That path must still carry tokens.
    const h = makeHarness({
      llm: {
        async *stream(opts: { signal?: AbortSignal }) {
          yield { kind: 'text', text: 'done' }
          yield { kind: 'finish', tokens: { input: 5, output: 6, total: 11 } }
          await new Promise<void>(resolve => {
            if (opts.signal?.aborted) return resolve()
            opts.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
        }
      } as LlmClient
    })
    const controller = new AbortController()
    const runPromise = h.runner.run(controller.signal)
    await new Promise(r => setTimeout(r, 20))
    controller.abort()
    await runPromise

    const assistant = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .find(m => m.role === 'assistant')
    expect(assistant?.tokens).toEqual({ input: 5, output: 6, total: 11 })
    expect(h.events.some(e => e.type === 'done' && e.reason === 'stopped')).toBe(true)
  })

  it('reports usage once per step, not once per run', async () => {
    const reported: number[] = []
    const h = makeHarness({
      tools: new Map([['read', stubTool('read')]]),
      onUsage: (t) => reported.push(t.total)
    })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} },
        { kind: 'finish', tokens: { input: 10, output: 1, total: 11 } }
      ],
      [
        { kind: 'text', text: 'done' },
        { kind: 'finish', tokens: { input: 20, output: 2, total: 22 } }
      ]
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(reported).toEqual([11, 22])
  })

  it('does not report usage when the provider omits it', async () => {
    const reported: unknown[] = []
    const h = makeHarness({ onUsage: (t) => reported.push(t) })
    h.llm.queue = [textParts('hi')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))

    expect(reported).toEqual([])
  })

  it('does not compact when compaction auto is disabled', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map<string, ToolDefinition>(),
      maxContextTokens: 200,
      compaction: { auto: false, buffer: 20, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000 },
      replaceItems: (items) => replaced.push(items),
      maxSteps: 1
    })
    h.items.push({ kind: 'message', message: { id: 'old', role: 'user', text: 'old '.repeat(5000), createdAt: 1 } })
    h.items.push({ kind: 'message', message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 } })
    h.llm.queue = [textParts('ok')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    expect(replaced).toHaveLength(0)
    const firstMessages = h.llm.calls[0]?.messages ?? []
    const texts = firstMessages
      .filter((m): m is { role: 'user'; content: string } => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content)
    expect(texts).toContain('latest prompt')
  })

  it('returns nearby AGENTS.md via onFileRead and does not inject a user message', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-loop-agents-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Root rules')
    writeFileSync(path.join(sub, 'AGENTS.md'), '# Sub rules')
    writeFileSync(path.join(sub, 'a.ts'), 'x')
    try {
      const readSpy = vi.fn(async (_input: Record<string, unknown>, ctx: { onFileRead?: (p: string) => string }) => {
        const reminder = ctx.onFileRead?.(path.join(sub, 'a.ts')) ?? ''
        return { output: 'x' + (reminder ? `\n\n${reminder}` : '') }
      })
      const h = makeHarness({
        cwd: dir,
        tools: new Map([['read', stubTool('read', readSpy)]])
      })
      h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'read src/a.ts', createdAt: 1 } })
      h.llm.queue = [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'src/a.ts' } },
          { kind: 'finish' }
        ],
        textParts('ok')
      ]
      h.runner.run()
      await new Promise(r => setTimeout(r, 20))
      const outputs = h.items
        .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
        .map(i => i.tool.output ?? '')
      expect(outputs.join('\n')).toContain('# Root rules')
      expect(outputs.join('\n')).toContain('# Sub rules')
      const userTexts = h.items
        .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message' && i.message.role === 'user')
        .map(i => i.message.text)
      expect(userTexts.join('\n')).not.toContain('Relevant project instructions')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not re-attach AGENTS.md already attached (cross-message dedupe)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-loop-agents-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const sub = path.join(dir, 'src')
    mkdirSync(sub)
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Root rules')
    writeFileSync(path.join(sub, 'AGENTS.md'), '# Sub rules')
    writeFileSync(path.join(sub, 'a.ts'), 'x')
    writeFileSync(path.join(sub, 'b.ts'), 'y')
    try {
      const readSpy = vi.fn(async (_input: Record<string, unknown>, ctx: { onFileRead?: (p: string) => string }) => {
        const f = (_input as { file_path: string }).file_path
        const full = path.join(sub, f)
        const reminder = ctx.onFileRead?.(full) ?? ''
        return { output: f + (reminder ? `\n\n${reminder}` : '') }
      })
      const h = makeHarness({
        cwd: dir,
        tools: new Map([['read', stubTool('read', readSpy)]])
      })
      h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'read both', createdAt: 1 } })
      h.llm.queue = [
        [
          { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'src/a.ts' } },
          { kind: 'tool-call', toolCallId: 'tc2', toolName: 'read', toolInput: { file_path: 'src/b.ts' } },
          { kind: 'finish' }
        ],
        textParts('ok')
      ]
      h.runner.run()
      await new Promise(r => setTimeout(r, 20))
      const outputs = h.items
        .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
        .map(i => i.tool.output ?? '')
      const reminders = outputs.filter(o => o.includes('<system-reminder>'))
      expect(reminders).toHaveLength(1)
      expect(reminders[0]).toContain('# Sub rules')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not attach instructions when no file was read', async () => {
    const h = makeHarness()
    h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'hi', createdAt: 1 } })
    h.llm.queue = [textParts('hello')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const toolOutputs = h.items
      .filter((i): i is { kind: 'tool'; tool: ToolCallData } => i.kind === 'tool')
      .map(i => i.tool.output ?? '')
    expect(toolOutputs.join('\n')).not.toContain('<system-reminder>')
  })

})

describe('SessionRunner compaction fallback', () => {
  function overflowHarness(replaced: TranscriptItem[][]) {
    return makeHarness({
      maxContextTokens: 200,
      compaction: { auto: true, buffer: 20, keepTokens: 100000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true },
      maxSteps: 1,
      replaceItems: (items) => replaced.push(items)
    })
  }

  it('clears tool output when there is no head to summarize', async () => {
    const replaced: TranscriptItem[][] = []
    const h = overflowHarness(replaced)
    h.items.push(
      { kind: 'message', message: { id: 'u1', role: 'user', text: 'question', createdAt: 1 } },
      { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'working', createdAt: 1 } },
      { kind: 'tool', tool: { id: 't1', tool: 'bash', input: {}, permission: 'allowed', output: 'x'.repeat(20000) } }
    )
    h.llm.queue = [textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(replaced.length).toBeGreaterThan(0)
    const last = replaced[replaced.length - 1]
    const toolItem = last.find(i => i.kind === 'tool')
    expect(toolItem?.kind === 'tool' && toolItem.tool.output).toBeUndefined()
    expect(h.events.map(e => e.type)).not.toContain('error')
  })

  it('does not touch a transcript that is already under the limit', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true },
      maxSteps: 1,
      replaceItems: (items) => replaced.push(items)
    })
    h.items.push({ kind: 'message', message: { id: 'u1', role: 'user', text: 'small', createdAt: 1 } })
    h.llm.queue = [textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(replaced).toHaveLength(0)
  })
})

describe('SessionRunner finish reasons', () => {
  it('reports a cut-off answer instead of calling it complete', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'text', text: 'half an ans' }, { kind: 'finish', finishReason: 'length' }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('length')
  })

  it('still reports complete when the model stops on its own', async () => {
    const h = makeHarness()
    h.llm.queue = [[{ kind: 'text', text: 'all done' }, { kind: 'finish', finishReason: 'stop' }]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('complete')
  })

  it('keeps max-steps as the reason even if the last step also hit the output cap', async () => {
    const h = makeHarness({ tools: new Map([['todowrite', stubTool('todowrite')]]), maxSteps: 1 })
    h.llm.queue = [[
      { kind: 'tool-call', toolCallId: 'tc1', toolName: 'todowrite', toolInput: {} },
      { kind: 'finish', finishReason: 'length' }
    ]]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('max-steps')
  })
})

describe('SessionRunner output reserve', () => {
  function harness(maxOutputTokens: number | undefined, replaced: TranscriptItem[][]) {
    return makeHarness({
      maxContextTokens: 1000,
      maxOutputTokens,
      compaction: { auto: true, buffer: 100, keepTokens: 100, tailTurns: 1, toolOutputMaxChars: 2000, prune: true },
      maxSteps: 1,
      replaceItems: (items) => replaced.push(items)
    })
  }

  function seed(h: ReturnType<typeof makeHarness>) {
    h.items.push(
      { kind: 'message', message: { id: 'u1', role: 'user', text: 'question', createdAt: 1 } },
      { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'working', createdAt: 1 } },
      { kind: 'tool', tool: { id: 't1', tool: 'bash', input: {}, permission: 'allowed', output: 'x'.repeat(1400) } }
    )
    h.llm.queue = [textParts('done')]
  }

  it('leaves a transcript alone when only the compaction buffer is reserved', async () => {
    const replaced: TranscriptItem[][] = []
    const h = harness(undefined, replaced)
    seed(h)
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(replaced).toHaveLength(0)
  })

  it('shrinks the same transcript once the model output budget is reserved too', async () => {
    const replaced: TranscriptItem[][] = []
    const h = harness(700, replaced)
    seed(h)
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(replaced.length).toBeGreaterThan(0)
  })

  it('asks the model for no more output than the verified wire budget', async () => {
    const h = makeHarness({ maxOutputTokensWire: 4096 })
    h.llm.queue = [textParts('ok')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    expect(h.llm.calls[0].maxOutputTokens).toBe(4096)
  })
})

describe('SessionRunner compact-on-reject', () => {
  const OVERFLOW = 'prompt is too long: 19000 tokens > 16000 maximum'

  // getItems/replaceItems phải cùng một array để sau compaction, retry đọc
  // transcript đã thu gọn chứ không phải bản gốc (giống store thật).
  function makeOverflowHarness(overrides: Partial<LoopDeps> = {}) {
    const replaced: TranscriptItem[][] = []
    let items: TranscriptItem[] = []
    const h = makeHarness({
      maxContextTokens: 1000,
      compaction: { auto: true, buffer: 100, keepTokens: 100, tailTurns: 1, toolOutputMaxChars: 2000, prune: true },
      maxSteps: 3,
      getItems: () => items,
      replaceItems: (next) => { replaced.push(next); items = next },
      ...overrides
    })
    const seed = () => {
      // Ít nhất 2 lượt user để head không rỗng (selectHeadTail giữ tailTurns=1
      // làm tail) — head rỗng sẽ rơi vào shrink(), không chạy compactTranscript.
      items.push(
        { kind: 'message', message: { id: 'u1', role: 'user', text: 'first', createdAt: 1 } },
        { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'reply', createdAt: 1 } },
        { kind: 'message', message: { id: 'u2', role: 'user', text: 'second', createdAt: 2 } },
        { kind: 'message', message: { id: 'a2', role: 'assistant', text: 'work', createdAt: 2 } },
        { kind: 'message', message: { id: 'u3', role: 'user', text: 'latest', createdAt: 3 } }
      )
    }
    return { ...h, replaced, seed }
  }

  it('force-compacts and retries when the provider rejects with a context overflow', async () => {
    const overflow: Array<{ promptTokens: number; message: string }> = []
    // Có tools để calls[2].tools.length > 0 phân biệt retry call với compaction
    // call (compactTranscript luôn truyền tools: []).
    const h = makeOverflowHarness({
      onContextOverflow: (promptTokens, message) => overflow.push({ promptTokens, message }),
      tools: new Map([['read', stubTool('read')]])
    })
    h.seed()
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary'),
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    expect(h.replaced.length).toBeGreaterThan(0)
    expect(overflow).toHaveLength(1)
    expect(overflow[0].message).toBe(OVERFLOW)
    expect(overflow[0].promptTokens).toBeGreaterThan(0)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }> | undefined
    expect(done).toBeDefined()
    expect(done?.reason).toBe('complete')
    // Lần gọi thứ 3 là retry của step 1 — vẫn còn tools (không phải step chết cuối).
    expect(h.llm.calls[2]?.tools.length).toBeGreaterThan(0)
  })

  it('stops after MAX_COMPACT_PER_RUN recoveries and surfaces the real error', async () => {
    const h = makeOverflowHarness()
    h.seed()
    // Chỉ lần recover 1 chạy LLM compaction (queue: summary1). Lần recover 2
    // gặp head rỗng — marker+summary bị stripCompactionPairs bỏ khỏi head —
    // nên compact() rơi vào shrink(), không tốn LLM call. Vì vậy lần reject thứ 3
    // chính là stream call kế tiếp và chạm cap → emit lỗi thật.
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary1'),
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      [{ kind: 'error', error: OVERFLOW, retryable: false }]
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const error = h.events.find(e => e.type === 'error') as Extract<ChatEvent, { type: 'error' }> | undefined
    expect(error).toBeDefined()
    expect(error?.message).toContain(OVERFLOW)
  })

  it('does not burn a step on the retry after a compact', async () => {
    const h = makeOverflowHarness({
      maxSteps: 2,
      tools: new Map([['read', stubTool('read')]])
    })
    h.seed()
    h.llm.queue = [
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary'),
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    // Retry vẫn là step 1 (steps-- khôi phục) nên vẫn có tools và tool chạy được.
    expect(h.llm.calls[2]?.tools.length).toBeGreaterThan(0)
    expect(h.appended.tools).toBe(1)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }> | undefined
    expect(done?.reason).toBe('complete')
  })
})

describe('SessionRunner compaction prompt size', () => {
  it('keeps the summary prompt inside the context budget', async () => {
    const calls: LlmStreamOptions[] = []
    const h = makeHarness({
      maxContextTokens: 4000,
      compaction: { auto: true, buffer: 200, keepTokens: 200, tailTurns: 1, toolOutputMaxChars: 500, prune: true },
      maxSteps: 1,
      replaceItems: () => {},
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          calls.push(opts)
          yield { kind: 'text', text: calls.length === 1 ? 'summary' : 'done' }
          yield { kind: 'finish' }
        }
      } as unknown as LlmClient
    })
    for (let i = 0; i < 6; i++) {
      h.items.push({ kind: 'message', message: { id: `u${i}`, role: 'user', text: `turn ${i} ` + 'x'.repeat(4000), createdAt: i } })
      h.items.push({ kind: 'message', message: { id: `a${i}`, role: 'assistant', text: 'ok', createdAt: i } })
    }
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))

    const compactionCall = calls[0]
    expect(compactionCall).toBeDefined()
    const promptChars = JSON.stringify(compactionCall.messages).length
    expect(promptChars / 3.5).toBeLessThanOrEqual(4000)
  })
})

describe('SessionRunner permission decisions', () => {
  it('decides a tool call permission once instead of re-deciding per stage', async () => {
    const h = makeHarness({ tools: new Map([['bash', stubTool('bash')]]) })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'ls' } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const forThisCall = h.decide.mock.calls.filter(c => c[1] !== undefined)
    expect(forThisCall).toHaveLength(1)
  })

  it('still reports the deny reason from the rule rather than the user', async () => {
    const h = makeHarness({ tools: new Map([['bash', stubTool('bash')]]), decidePermission: vi.fn(() => 'deny' as const) })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'bash', toolInput: { command: 'ls' } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))
    const result = h.events.find(e => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.call.error).toMatch(/not permitted/)
  })
})

describe('SessionRunner system prompt', () => {
  it('re-resolves a dynamic system prompt at the start of each run', async () => {
    let n = 0
    const h = makeHarness({ system: () => `prompt ${++n}` })
    h.llm.queue = [textParts('a')]
    await h.runner.run()
    h.llm.queue = [textParts('b')]
    await h.runner.run()
    expect(h.llm.calls[0].system).toBe('prompt 1')
    expect(h.llm.calls[1].system).toBe('prompt 2')
  })

  it('resolves it once per run, not once per step', async () => {
    let n = 0
    const h = makeHarness({
      system: () => `prompt ${++n}`,
      tools: new Map([['todowrite', stubTool('todowrite')]]),
      maxSteps: 3
    })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'todowrite', toolInput: {} }, { kind: 'finish' }],
      textParts('done')
    ]
    await h.runner.run()
    expect(h.llm.calls).toHaveLength(2)
    expect(h.llm.calls[0].system).toBe('prompt 1')
    expect(h.llm.calls[1].system).toBe('prompt 1')
  })

  it('still accepts a plain string system prompt', async () => {
    const h = makeHarness({ system: 'fixed prompt' })
    h.llm.queue = [textParts('a')]
    await h.runner.run()
    expect(h.llm.calls[0].system).toBe('fixed prompt')
  })
})
