import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTaskTool, SUBAGENT_CONFIGS } from '../../src/main/agent/tools/task'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import type { ToolContext } from '../../src/main/agent/tools/types'

const dirs: string[] = []

function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-task-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
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

const ctx: ToolContext = { cwd: '', ask: async () => null }

describe('task subagent configs', () => {
  it('defines three subagent types with expected tool sets', () => {
    expect(SUBAGENT_CONFIGS.research.tools).toEqual(['read', 'glob', 'grep', 'webfetch'])
    expect(SUBAGENT_CONFIGS.general.tools).toEqual(
      expect.arrayContaining(['write', 'edit', 'apply-patch', 'bash', 'git', 'todowrite'])
    )
    expect(SUBAGENT_CONFIGS.reviewer.tools).toEqual(expect.arrayContaining(['git']))
    expect(SUBAGENT_CONFIGS.general.system).toMatch(/DONE/)
    expect(SUBAGENT_CONFIGS.reviewer.system).toMatch(/APPROVED/)
  })

  it('research subagent cannot write (no write tool)', async () => {
    const dir = tempDir()
    ctx.cwd = dir
    const tool = createTaskTool({
      llm: stubLlm([[{ kind: 'tool-call', toolCallId: 'c1', toolName: 'write', toolInput: { file_path: 'x', content: 'y' } }, { kind: 'finish' }]]),
      model: 'm',
      tools: createDefaultTools()
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
      tools: createDefaultTools()
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
    const tool = createTaskTool({ llm, model: 'm', tools: createDefaultTools() })
    const r1 = await tool.run({ description: 'one', prompt: 'do one', subagent_type: 'research' }, ctx)
    const id = /<task id="([^"]+)"/.exec(r1.output ?? '')?.[1]
    expect(id).toBeTruthy()
    const r2 = await tool.run({ description: 'two', prompt: 'do two', subagent_type: 'research', task_id: id }, ctx)
    expect(r2.output).toContain('step two result')
    const resumed = requests[1] ?? []
    expect(resumed.some(c => c.includes('step one result'))).toBe(true)
    expect(resumed.some(c => c.includes('do two'))).toBe(true)
  })
})
