import { describe, expect, it, vi } from 'vitest'
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
    expect(resultEvent.call.error).toBe('permission denied')
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

  it('prunes the transcript when over the context budget', async () => {
    const h = makeHarness({
      tools: new Map<string, ToolDefinition>(),
      maxContextChars: 100,
      maxSteps: 1
    })
    h.items.push({
      kind: 'message',
      message: { id: 'old', role: 'user', text: 'old '.repeat(200), createdAt: 1 }
    })
    h.items.push({
      kind: 'message',
      message: { id: 'recent', role: 'user', text: 'latest prompt', createdAt: 2 }
    })
    h.llm.queue = [textParts('ok')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))
    const firstMessages = h.llm.calls[0]?.messages ?? []
    const texts = firstMessages
      .filter((m): m is { role: 'user'; content: string } => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content)
    expect(texts[0]).toContain('truncated')
    expect(texts[texts.length - 1]).toBe('latest prompt')
  })
})
