import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTaskTool } from '../../src/main/agent/tools/task'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { BUILTIN_ROLES } from '../../src/main/agent/subagent-roles'
import type { ToolPermissionContext } from '../../src/main/agent/permission'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { ToolContext, SubagentToolEvent, ToolDefinition } from '../../src/main/agent/tools/types'

const { subagentRunners } = vi.hoisted(() => ({
  subagentRunners: [] as Array<{ agentId: string; turn?: number }>
}))

vi.mock('../../src/main/agent/loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/agent/loop')>()
  return {
    ...actual,
    SessionRunner: class extends actual.SessionRunner {
      constructor(deps: ConstructorParameters<typeof actual.SessionRunner>[0]) {
        super(deps)
        subagentRunners.push({ agentId: deps.agentId, turn: deps.turn })
      }
    }
  }
})

const dirs: string[] = []

function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-task-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  subagentRunners.length = 0
})

function stubLlm(partsQueue: LlmStreamPart[][], onRequest?: (req: LlmStreamOptions) => void): LlmClient {
  return {
    async *stream(request: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      onRequest?.(request)
      const parts = partsQueue.shift() ?? [{ kind: 'text', text: 'ok' }, { kind: 'finish' }]
      for (const p of parts) yield p
    }
  }
}

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

const ctx: ToolContext = { cwd: '', ask: async () => null }

describe('task subagent roles', () => {
  it('defines three built-in roles with expected tool sets', () => {
    expect(BUILTIN_ROLES.map(r => r.name).sort()).toEqual(['general', 'research', 'reviewer'])
  })

  it('research subagent cannot write (no write tool)', async () => {
    const dir = tempDir()
    ctx.cwd = dir
    const tool = createTaskTool({
      llm: stubLlm([[{ kind: 'tool-call', toolCallId: 'c1', toolName: 'write', toolInput: { file_path: 'x', content: 'y' } }, { kind: 'finish' }]]),
      model: 'm',
      tools: createDefaultTools(),
      permission: allowAll()
    })
    const r = await tool.run({ description: 'try write', prompt: 'write x', subagent_type: 'research' }, ctx)
    expect(existsSync(path.join(dir, 'x'))).toBe(false)
    expect(r.output).toBeTruthy()
  })

  it('general subagent can write files', async () => {
    const dir = tempDir()
    ctx.cwd = dir
    const tool = createTaskTool({
      llm: stubLlm([
        [{ kind: 'tool-call', toolCallId: 'c1', toolName: 'write', toolInput: { file_path: 'a.txt', content: 'hi' } }, { kind: 'finish' }],
        [{ kind: 'text', text: 'DONE - wrote a.txt' }, { kind: 'finish' }]
      ]),
      model: 'm',
      tools: createDefaultTools(),
      permission: allowAll()
    })
    const r = await tool.run({ description: 'write file', prompt: 'write a.txt', subagent_type: 'general' }, ctx)
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf-8')).toBe('hi')
    expect(r.output).toContain('DONE - wrote a.txt')
    expect(r.output).toMatch(/<task id=/)
  })

  it('resumes a subagent session via task_id', async () => {
    const dir = tempDir()
    ctx.cwd = dir
    const requests: string[][] = []
    const llm = stubLlm([
      [{ kind: 'text', text: 'step one result' }, { kind: 'finish' }],
      [{ kind: 'text', text: 'step two result' }, { kind: 'finish' }]
    ], req => requests.push(req.messages.map(m => JSON.stringify(m.content))))
    const tool = createTaskTool({ llm, model: 'm', tools: createDefaultTools(), permission: allowAll() })
    const r1 = await tool.run({ description: 'one', prompt: 'do one', subagent_type: 'research' }, ctx)
    const id = /<task id="([^"]+)"/.exec(r1.output ?? '')?.[1]
    expect(id).toBeTruthy()
    const r2 = await tool.run({ description: 'two', prompt: 'do two', subagent_type: 'research', task_id: id }, ctx)
    expect(r2.output).toContain('step two result')
    const resumed = requests[1] ?? []
    expect(resumed.some(c => c.includes('step one result'))).toBe(true)
    expect(resumed.some(c => c.includes('do two'))).toBe(true)
  })

  it('constructs the subagent SessionRunner with a real agentId and parent turn', async () => {
    const tool = createTaskTool({
      llm: stubLlm([[{ kind: 'text', text: 'ok' }, { kind: 'finish' }]]),
      model: 'm',
      tools: createDefaultTools(),
      permission: allowAll()
    })
    await tool.run(
      { description: 'explore', prompt: 'find it', subagent_type: 'research' },
      { ...ctx, turn: 7 }
    )
    expect(subagentRunners).toHaveLength(1)
    expect(subagentRunners[0].agentId).toMatch(/^sub-(research|general|reviewer)-/)
    expect(subagentRunners[0].agentId).not.toBe('sub')
    expect(subagentRunners[0].turn).toBe(7)
  })

  it('emits subagent events with parentTaskId from the parent task context', async () => {
    const events: Array<{ taskId: string } & SubagentToolEvent> = []
    const tool = createTaskTool({
      llm: stubLlm([[{ kind: 'text', text: 'ok' }, { kind: 'finish' }]]),
      model: 'm',
      tools: createDefaultTools(),
      permission: allowAll()
    })
    await tool.run(
      { description: 'explore', prompt: 'go', subagent_type: 'general' },
      { ...ctx, taskId: 'parent-1', emitSubagent: (taskId, e) => events.push({ taskId, ...e }) }
    )
    expect(events.length).toBeGreaterThan(0)
    const delta = events.find(e => e.sub === 'delta')
    expect(delta?.parentTaskId).toBe('parent-1')
    const done = events.find(e => e.sub === 'done')
    expect(done?.parentTaskId).toBe('parent-1')
  })

  it('runs a role defined by a project file', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'meow-task-'))
    dirs.push(cwd)
    mkdirSync(path.join(cwd, '.meow', 'agents'), { recursive: true })
    writeFileSync(
      path.join(cwd, '.meow', 'agents', 'auditor.md'),
      ['---', 'name: auditor', 'tools: read, grep', '---', 'You audit.'].join('\n')
    )
    const llm = new StubLlm()
    const task = createTaskTool({
      llm,
      model: 'm',
      tools: new Map([['read', stubTool('read')], ['grep', stubTool('grep')], ['bash', stubTool('bash')]]),
      permission: allowAll()
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'auditor' }, { cwd, ask: async () => null })
    expect(r.error).toBeUndefined()
    expect(llm.calls[0]?.system).toContain('You audit.')
    expect((llm.calls[0]?.tools ?? []).map(t => t.name).sort()).toEqual(['grep', 'read'])
  })

  it('rejects an unknown role and names the valid ones', async () => {
    const task = createTaskTool({
      llm: new StubLlm(),
      model: 'm',
      tools: new Map([['read', stubTool('read')]]),
      permission: allowAll()
    })
    const r = await task.run({ prompt: 'x', subagent_type: 'nope' }, { cwd: '/proj', ask: async () => null })
    expect(r.error).toContain('nope')
    expect(r.error).toContain('research')
  })

  it('lets plan mode reach the task tool at all', async () => {
    const { PLAN_RULES } = await import('../../src/main/agent/permission')
    expect(PLAN_RULES.task).toBe('allow')
  })

  it('allows only the read-only research role in plan mode', async () => {
    const tools = new Map([['read', stubTool('read')]])
    const research = createTaskTool({ llm: new StubLlm(), model: 'm', tools, permission: allowAll('plan') })
    const ok = await research.run({ prompt: 'x', subagent_type: 'research' }, { cwd: '/p', ask: async () => null })
    expect(ok.error).toBeUndefined()

    const general = createTaskTool({ llm: new StubLlm(), model: 'm', tools, permission: allowAll('plan') })
    const blocked = await general.run({ prompt: 'x', subagent_type: 'general' }, { cwd: '/p', ask: async () => null })
    expect(blocked.error).toMatch(/plan mode/i)
  })
})
