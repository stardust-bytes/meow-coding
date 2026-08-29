import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTaskTool } from '../../src/main/agent/tools/task'
import type { ToolPermissionContext } from '../../src/main/agent/permission'
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

function allowAll(mode: 'build' | 'plan' = 'build'): () => ToolPermissionContext {
  return () => ({ mode, rules: { '*': 'allow' }, isSavedAllow: () => false, canPrompt: true })
}

// LlmStreamPart carries a tool call as toolName/toolCallId/toolInput (see llm.ts:11).
class ToolCallingLlm implements LlmClient {
  private called = false
  constructor(private toolName: string, private toolInput: Record<string, unknown> = {}) {}
  async *stream(): AsyncGenerator<LlmStreamPart> {
    if (!this.called) {
      this.called = true
      yield { kind: 'tool-call', toolCallId: 't1', toolName: this.toolName, toolInput: this.toolInput }
      yield { kind: 'finish' }
      return
    }
    yield { kind: 'text', text: 'finished' }
    yield { kind: 'finish' }
  }
}

// Always calls a tool, so the loop only stops when it runs out of steps. The
// final step still yields a tool call (the runner strips tools, not the LLM),
// so the loop ends on isLastStep and reports max-steps instead of complete.
class NeverFinishingLlm implements LlmClient {
  async *stream(): AsyncGenerator<LlmStreamPart> {
    yield { kind: 'text', text: 'partial progress' }
    yield { kind: 'tool-call', toolCallId: 't', toolName: 'read', toolInput: {} }
    yield { kind: 'finish' }
  }
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
    const task = createTaskTool({ llm, model: 'm', tools, permission: allowAll() })
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
      compaction: { auto: true, buffer: 200, keepTokens: 500, tailTurns: 2, toolOutputMaxChars: 500, prune: true },
      permission: allowAll()
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
      onUsage: (tokens) => usage.push({ input: tokens.input, output: tokens.output }),
      permission: allowAll()
    })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    await task.run({ prompt: 'x', subagent_type: 'research' }, ctx)

    expect(usage).toEqual([{ input: 120, output: 30 }, { input: 40, output: 10 }])
  })

  it('links a background subagent to the parent abort signal', async () => {
    const controller = new AbortController()
    let subSignal: AbortSignal | undefined
    const llm: LlmClient = {
      async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
        subSignal = opts.signal
        // Stay alive until the signal fires so the abort link is observable.
        await new Promise<void>(resolve => {
          const t = setTimeout(resolve, 500)
          opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
        })
        yield { kind: 'text', text: 'stopped' }
        yield { kind: 'finish' }
      }
    }
    const task = createTaskTool({ llm, model: 'm', tools: new Map([['read', stubTool('read')]]) })
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null, signal: controller.signal }
    await task.run({ prompt: 'x', background: true }, ctx)
    await new Promise(r => setTimeout(r, 10))
    // The background subagent gets its own controller, linked to the parent's
    // so the turn ending still stops it.
    expect(subSignal).toBeDefined()
    expect(subSignal).not.toBe(controller.signal)
    controller.abort()
    await new Promise(r => setTimeout(r, 20))
    expect(subSignal?.aborted).toBe(true)
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

describe('subagent permission', () => {
  it('denies a tool the parent denies, even though the subagent has it', async () => {
    const ran: string[] = []
    const git: ToolDefinition = {
      name: 'git', description: 'git', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('git'); return { output: 'ok' } }
    }
    const task = createTaskTool({
      llm: new ToolCallingLlm('git'),
      model: 'm',
      tools: new Map([['git', git], ['read', stubTool('read')]]),
      permission: () => ({ mode: 'build', rules: { git: 'deny' }, isSavedAllow: () => false, canPrompt: true })
    })
    await task.run({ prompt: 'x', subagent_type: 'reviewer' }, { cwd: '/p', ask: async () => null })
    expect(ran).toEqual([])
  })

  it('bubbles an ask to the parent and runs the tool once allowed', async () => {
    const ran: string[] = []
    const bash: ToolDefinition = {
      name: 'bash', description: 'bash', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('bash'); return { output: 'ok' } }
    }
    const prompts: Array<{ taskId: string; subagentType: string }> = []
    const task = createTaskTool({
      llm: new ToolCallingLlm('bash', { command: 'ls' }),
      model: 'm',
      tools: new Map([['bash', bash]]),
      permission: () => ({ mode: 'build', rules: { bash: 'ask' }, isSavedAllow: () => false, canPrompt: true }),
      ask: async () => ({ allow: true }),
      onPromptRequest: (_e, meta) => prompts.push(meta)
    })
    await task.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(ran).toEqual(['bash'])
    expect(prompts[0]?.subagentType).toBe('general')
    expect(prompts[0]?.taskId).toBeTruthy()
  })

  it('denies rather than hanging when a background subagent needs to ask', async () => {
    const ran: string[] = []
    const bash: ToolDefinition = {
      name: 'bash', description: 'bash', schema: { parse: () => ({}) } as never,
      run: async () => { ran.push('bash'); return { output: 'ok' } }
    }
    let finished = false
    const task = createTaskTool({
      llm: new ToolCallingLlm('bash', { command: 'ls' }),
      model: 'm',
      tools: new Map([['bash', bash]]),
      permission: () => ({ mode: 'build', rules: { bash: 'ask' }, isSavedAllow: () => false, canPrompt: true }),
      ask: async () => ({ allow: true }),
      onBackgroundResult: () => { finished = true }
    })
    await task.run({ prompt: 'x', subagent_type: 'general', background: true }, { cwd: '/p', ask: async () => null })
    await new Promise(r => setTimeout(r, 20))
    expect(ran).toEqual([])
    expect(finished).toBe(true)
  })
})

describe('subagent snapshots and todo filtering', () => {
  it('never hands todowrite to a subagent', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'meow-task-todo-'))
    mkdirSync(path.join(cwd, '.meow', 'agents'), { recursive: true })
    writeFileSync(
      path.join(cwd, '.meow', 'agents', 'planner.md'),
      ['---', 'name: planner', 'tools: read, todowrite', '---', 'You plan.'].join('\n')
    )
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')], ['todowrite', stubTool('todowrite')]]),
      permission: allowAll()
    })
    await task.run({ prompt: 'x', subagent_type: 'planner' }, { cwd, ask: async () => null })
    expect((llm.calls[0]?.tools ?? []).map(t => t.name)).toEqual(['read'])
  })

  it('passes the parent snapshot store and agent id to the subagent runner', async () => {
    const seen: Array<Record<string, unknown>> = []
    const probe: ToolDefinition = {
      name: 'write', description: 'write', schema: { parse: () => ({}) } as never,
      run: async (_input, ctx) => {
        seen.push({ snapshotAgentId: ctx.snapshotAgentId, hasStore: Boolean(ctx.snapshots) })
        return { output: 'ok' }
      }
    }
    const task = createTaskTool({
      llm: new ToolCallingLlm('write'),
      model: 'm',
      tools: new Map([['write', probe]]),
      permission: allowAll(),
      snapshots: { snapshot: () => {} } as never,
      parentAgentId: 'agent-parent'
    })
    await task.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(seen[0]).toEqual({ snapshotAgentId: 'agent-parent', hasStore: true })
  })
})

describe('subagent step budget', () => {
  it('reports an incomplete task when the subagent runs out of steps', async () => {
    const task = createTaskTool({
      llm: new NeverFinishingLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      maxSteps: 2
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'research' }, { cwd: '/p', ask: async () => null })
    expect(r.output).toContain('state="incomplete"')
    expect(r.output).toContain('reason="max-steps"')
    expect(r.output).toContain('partial progress')
  })
})

describe('background subagent lifecycle', () => {
  it('hands the caller a cancel handle that stops the run', async () => {
    let cancel: (() => void) | undefined
    let result: { text: string; error?: string } | undefined
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      onBackgroundStart: (_id, c) => { cancel = c },
      onBackgroundResult: (_id, text, error) => { result = { text, error } }
    })
    await task.run({ prompt: 'x', subagent_type: 'research', background: true }, { cwd: '/p', ask: async () => null })
    expect(typeof cancel).toBe('function')
    cancel!()
    await new Promise(r => setTimeout(r, 20))
    expect(result).toBeDefined()
  })

  it('emits the background done event with the parent task id', async () => {
    const events: Array<{ sub: string; parentTaskId?: string }> = []
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      onBackgroundResult: () => {}
    })
    await task.run(
      { prompt: 'x', subagent_type: 'research', background: true },
      { cwd: '/p', ask: async () => null, taskId: 'parent-task', emitSubagent: (_id, e) => events.push(e) }
    )
    await new Promise(r => setTimeout(r, 20))
    const done = events.find(e => e.sub === 'done')
    expect(done?.parentTaskId).toBe('parent-task')
  })
})

describe('subagent error surfacing', () => {
  // The subagent's LLM call is rejected up front (e.g. a provider that refuses
  // the model, like the China-hosted opt-in rejection), so it produces no text.
  class FailingLlm implements LlmClient {
    async *stream(): AsyncGenerator<LlmStreamPart> {
      yield {
        kind: 'error',
        error: 'The latest version of this model is only available hosted in China and requires explicit opt in: https://opencode.ai/workspace/wrk_TEST/go',
        retryable: false
      }
    }
  }

  it('returns the real LLM error to the parent, not a generic no-answer', async () => {
    const task = createTaskTool({
      llm: new FailingLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll()
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'research' }, { cwd: '/p', ask: async () => null })
    expect(r.error).toBeDefined()
    expect(r.error).toContain('only available hosted in China')
    expect(r.error).not.toBe('task: subagent produced no answer')
  })

  it('carries the real error text on the panel done event, not just state error', async () => {
    const events: Array<{ sub: string; state?: string; text?: string }> = []
    const task = createTaskTool({
      llm: new FailingLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll()
    })
    await task.run(
      { prompt: 'x', subagent_type: 'research' },
      { cwd: '/p', ask: async () => null, emitSubagent: (_id, e) => events.push(e) }
    )
    const done = events.find(e => e.sub === 'done')
    expect(done?.state).toBe('error')
    expect(done?.text).toContain('only available hosted in China')
  })

  it('delivers the real error text for a background subagent too', async () => {
    const events: Array<{ sub: string; state?: string; text?: string }> = []
    let delivered: { text: string; error?: string } | null = null
    const task = createTaskTool({
      llm: new FailingLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll(),
      onBackgroundResult: (id, text, error) => { delivered = { text, error } }
    })
    await task.run(
      { prompt: 'x', subagent_type: 'research', background: true },
      { cwd: '/p', ask: async () => null, emitSubagent: (_id, e) => events.push(e) }
    )
    await new Promise(r => setTimeout(r, 20))
    const done = events.find(e => e.sub === 'done')
    expect(done?.state).toBe('error')
    expect(done?.text).toContain('only available hosted in China')
    expect(delivered?.error).toContain('only available hosted in China')
  })
})
