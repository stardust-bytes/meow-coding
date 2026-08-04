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
    expect(r.output).toBe('sub result')
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
})
