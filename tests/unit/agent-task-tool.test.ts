import { describe, expect, it } from 'vitest'
import { createTaskTool } from '../../src/main/agent/tools/task'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { ToolDefinition, ToolContext } from '../../src/main/agent/tools/types'

class StubLlm implements LlmClient {
  calls: LlmStreamOptions[] = []

  async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
    this.calls.push(opts)
    yield { kind: 'text', text: 'sub result' }
    yield { kind: 'finish' }
  }
}

function stubTool(name: string): ToolDefinition {
  return { name, description: name, schema: { parse: () => ({}) } as never, run: async () => ({ output: 'x' }) }
}

describe('task tool (subagent)', () => {
  it('runs a subagent and returns its final answer', async () => {
    const llm = new StubLlm()
    const tools = new Map<string, ToolDefinition>([
      ['read', stubTool('read')],
      ['bash', stubTool('bash')],
      ['write', stubTool('write')]
    ])
    const task = createTaskTool({ llm, model: 'm', tools })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await task.run({ prompt: 'find the bug' }, ctx)
    expect(r.output).toContain('sub result')
    expect(r.output).toMatch(/<task id=/)
  })

  it('only exposes read-only tools to the subagent', async () => {
    const llm = new StubLlm()
    const tools = new Map<string, ToolDefinition>([
      ['read', stubTool('read')],
      ['glob', stubTool('glob')],
      ['grep', stubTool('grep')],
      ['bash', stubTool('bash')],
      ['write', stubTool('write')]
    ])
    const task = createTaskTool({ llm, model: 'm', tools })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x' }, ctx)
    const subTools = llm.calls[0]?.tools ?? []
    const names = subTools.map(t => t.name).sort()
    expect(names).toEqual(['glob', 'grep', 'read'])
  })

  it('uses a dedicated model/llm when resolveSubagent returns one', async () => {
    const mainLlm = new StubLlm()
    const subLlm = new StubLlm()
    const task = createTaskTool({
      llm: mainLlm,
      model: 'main-model',
      tools: new Map([['read', stubTool('read')]]),
      resolveSubagent: (type) => type === 'research'
        ? { provider: 'p2', model: 'x-model', llm: subLlm }
        : undefined
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x' }, ctx)
    expect(mainLlm.calls).toHaveLength(0)
    expect(subLlm.calls).toHaveLength(1)
    expect(subLlm.calls[0].model).toBe('x-model')
  })

  it('falls back to the main model/llm when resolveSubagent is undefined', async () => {
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'main-model',
      tools: new Map([['read', stubTool('read')]]),
      resolveSubagent: () => undefined
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x' }, ctx)
    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].model).toBe('main-model')
  })

  it('background=true returns immediately and reports the result via callback', async () => {
    const llm = new StubLlm()
    const tools = new Map<string, ToolDefinition>([['read', stubTool('read')]])
    let done: { id: string; text: string } | null = null
    const task = createTaskTool({
      llm, model: 'm', tools,
      onBackgroundResult: (id, text) => { done = { id, text } }
    })
    const events: Array<{ sub: string; state?: string; result?: string }> = []
    const ctx: ToolContext = {
      cwd: '/proj',
      ask: async () => null,
      emitSubagent: (_id, e) => events.push(e)
    }
    const r = await task.run({ prompt: 'bg task', background: true }, ctx)
    // Returns immediately with a "running in background" marker.
    expect(r.background).toBe(true)
    expect(r.output).toContain('running in background')
    // The subagent eventually completes and the callback fires.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(done).not.toBeNull()
    expect(done!.text).toContain('sub result')
    expect(events.some(e => e.sub === 'done' && e.state === 'completed')).toBe(true)
  })
})

describe('task tool context and lifecycle', () => {
  function bigOutputTool(name: string, size: number): ToolDefinition {
    return {
      name,
      description: name,
      schema: { parse: () => ({}) } as never,
      run: async () => ({ output: 'x'.repeat(size) })
    }
  }

  class ToolThenTextLlm implements LlmClient {
    calls: LlmStreamOptions[] = []
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      this.calls.push(opts)
      if (this.calls.length === 1) {
        yield { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: {} }
        yield { kind: 'finish', tokens: { input: 120, output: 30, total: 150 } }
        return
      }
      yield { kind: 'text', text: 'sub result' }
      yield { kind: 'finish', tokens: { input: 40, output: 10, total: 50 } }
    }
  }

  it('keeps the subagent transcript under its context limit', async () => {
    const llm = new ToolThenTextLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', bigOutputTool('read', 40000)]]),
      maxContextTokens: 2000,
      compaction: { auto: true, buffer: 200, keepTokens: 500, tailTurns: 2, toolOutputMaxChars: 500, prune: true }
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x', subagent_type: 'research' }, ctx)

    const secondCall = llm.calls[1]
    expect(secondCall).toBeDefined()
    expect(JSON.stringify(secondCall.messages).length).toBeLessThan(40000)
  })

  it('reports subagent token usage to the parent', async () => {
    const llm = new ToolThenTextLlm()
    const usage: Array<{ input: number; output: number }> = []
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      onUsage: (tokens) => usage.push({ input: tokens.input, output: tokens.output })
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x', subagent_type: 'research' }, ctx)

    expect(usage).toEqual([{ input: 120, output: 30 }, { input: 40, output: 10 }])
  })

  it('passes the parent abort signal to a background subagent', async () => {
    const llm = new StubLlm()
    const controller = new AbortController()
    const task = createTaskTool({ llm, model: 'm', tools: new Map([['read', stubTool('read')]]) })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null, signal: controller.signal }
    await task.run({ prompt: 'x', background: true }, ctx)
    await new Promise(r => setTimeout(r, 20))
    expect(llm.calls[0]?.signal).toBe(controller.signal)
  })

  it('evicts the oldest subagent sessions instead of growing forever', async () => {
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      maxSessions: 2
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await task.run({ prompt: `question-${i}` }, ctx)
      ids.push(/<task id="([^"]+)"/.exec(r.output ?? '')?.[1] ?? '')
    }

    llm.calls.length = 0
    await task.run({ prompt: 'again', task_id: ids[0] }, ctx)
    expect(JSON.stringify(llm.calls[0].messages)).not.toContain('question-0')

    llm.calls.length = 0
    await task.run({ prompt: 'again', task_id: ids[2] }, ctx)
    expect(JSON.stringify(llm.calls[0].messages)).toContain('question-2')
  })
})
