import { describe, expect, it, vi } from 'vitest'
import { SessionRunner } from '../../src/main/agent/loop'
import type { LoopDeps } from '../../src/main/agent/loop'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { ToolDefinition } from '../../src/main/agent/tools/types'
import type { TranscriptItem } from '../../src/main/agent/message'
import type { ChatEvent, ChatMessage, QueuedMessage, ToolCallData } from '../../src/shared/types'

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

function textParts(...texts: string[]): LlmStreamPart[] {
  return [...texts.map(t => ({ kind: 'text' as const, text: t })), { kind: 'finish' as const }]
}

interface Harness {
  runner: SessionRunner
  events: ChatEvent[]
  items: TranscriptItem[]
  llm: StubLlm
}

function makeHarness(overrides: Partial<LoopDeps> = {}): Harness {
  const llm = new StubLlm()
  const items: TranscriptItem[] = []
  const events: ChatEvent[] = []
  const deps: LoopDeps = {
    agentId: 'a1',
    model: 'test-model',
    system: 'You are a test agent.',
    cwd: '/proj',
    llm,
    tools: new Map<string, ToolDefinition>(),
    decidePermission: () => 'allow',
    ask: async () => null,
    maxSteps: 10,
    onEvent: (e) => events.push(e),
    getItems: () => items,
    appendMessage: (m: ChatMessage) => { items.push({ kind: 'message', message: m }) },
    appendTool: (t: ToolCallData) => { items.push({ kind: 'tool', tool: t }) },
    ...overrides
  }
  return { runner: new SessionRunner(deps), events, items, llm }
}

function steer(text: string, id = `s-${Math.random().toString(36).slice(2)}`): QueuedMessage {
  return { id, text, displayText: text }
}

describe('SessionRunner steering', () => {
  it('injects a pending steer as a user message at the step boundary', async () => {
    const pending = [steer('keep going, use green colors')]
    const h = makeHarness({
      tools: new Map([['todowrite', stubTool('todowrite')]]),
      takeSteers: () => pending.splice(0)
    })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'todowrite', toolInput: { todos: [] } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    const userMsg = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .find(m => m.role === 'user')
    expect(userMsg?.text).toBe('keep going, use green colors')
    expect(h.events.some(e => e.type === 'user-message')).toBe(true)

    // The next provider turn includes the steered message in context.
    const secondMessages = h.llm.calls[1]?.messages ?? []
    expect(JSON.stringify(secondMessages)).toContain('keep going, use green colors')
  })

  it('resets the step counter after injecting a steer', async () => {
    let calls = 0
    const h = makeHarness({
      tools: new Map([['todowrite', stubTool('todowrite')]]),
      maxSteps: 2,
      // The steer arrives mid-turn (second loop iteration, i.e. after the
      // first tool step) like a user message sent while the agent runs.
      takeSteers: () => (++calls === 2 ? [steer('steer me')] : [])
    })
    // maxSteps=2 without steering would stop at the 2nd step with max-steps.
    // Steering resets steps=0 after the 1st tool step, so a 3rd provider turn
    // runs and the run completes instead of hitting the budget.
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'todowrite', toolInput: { todos: [] } }, { kind: 'finish' }],
      [{ kind: 'tool-call', toolCallId: 'tc2', toolName: 'todowrite', toolInput: { todos: [] } }, { kind: 'finish' }],
      textParts('all done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 50))

    expect(h.llm.calls.length).toBe(3)
    const done = h.events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    expect(done.reason).toBe('complete')
  })

  it('does nothing when there are no steers', async () => {
    const h = makeHarness({
      takeSteers: () => []
    })
    h.llm.queue = [textParts('hi')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 20))

    const userMessages = h.items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .filter(m => m.role === 'user')
    expect(userMessages).toHaveLength(0)
    expect(h.events.some(e => e.type === 'user-message')).toBe(false)
    expect(h.events.some(e => e.type === 'done' && e.reason === 'complete')).toBe(true)
  })
})
