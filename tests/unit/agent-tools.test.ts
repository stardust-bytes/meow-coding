import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readTool } from '../../src/main/agent/tools/read'
import { writeTool } from '../../src/main/agent/tools/write'
import { editTool } from '../../src/main/agent/tools/edit'
import { globTool } from '../../src/main/agent/tools/glob'
import { grepTool } from '../../src/main/agent/tools/grep'
import { applyPatchTool } from '../../src/main/agent/tools/apply-patch'
import { todowriteTool } from '../../src/main/agent/tools/todowrite'
import { questionTool } from '../../src/main/agent/tools/question'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir: string
const ctx: ToolContext = {
  cwd: '',
  ask: async (q) => (q.question === 'what is your name?' ? 'meow' : null)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-tools-'))
  ctx.cwd = dir
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('write', () => {
  it('creates a file with nested directories', async () => {
    const r = await writeTool.run({ file_path: 'src/a.ts', content: 'hello' }, ctx)
    expect(r.output).toBe('wrote src/a.ts')
    const fs = await import('node:fs')
    expect(fs.readFileSync(path.join(dir, 'src', 'a.ts'), 'utf-8')).toBe('hello')
  })
})

describe('read', () => {
  it('reads a file', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'one\ntwo\nthree\n')
    const r = await readTool.run({ file_path: 'f.txt' }, ctx)
    expect(r.output).toContain('one')
  })

  it('reports a missing file', async () => {
    const r = await readTool.run({ file_path: 'nope.txt' }, ctx)
    expect(r.error).toMatch(/not found/)
  })

  it('caps oversized output so one read cannot blow the context budget', async () => {
    writeFileSync(path.join(dir, 'big.txt'), 'a'.repeat(100000))
    const r = await readTool.run({ file_path: 'big.txt' }, ctx)
    expect(r.output).toContain('truncated')
    expect(r.output!.length).toBeLessThan(25000)
  })
})

describe('edit', () => {
  it('replaces a unique match', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'a\nbbb\nc\n')
    const r = await editTool.run({ file_path: 'f.txt', old_string: 'bbb', new_string: 'B' }, ctx)
    expect(r.output).toContain('edited')
    const fs = await import('node:fs')
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('a\nB\nc\n')
  })

  it('errors on no match or ambiguous match', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'x\n')
    expect((await editTool.run({ file_path: 'f.txt', old_string: 'zzz', new_string: 'y' }, ctx)).error).toBeTruthy()
    writeFileSync(path.join(dir, 'f.txt'), 'dup\ndup\n')
    const r = await editTool.run({ file_path: 'f.txt', old_string: 'dup', new_string: 'y' }, ctx)
    expect(r.error).toMatch(/matched 2 times/)
  })
})

describe('glob', () => {
  it('finds matching files relative to cwd', async () => {
    mkdirSync(path.join(dir, 'src'))
    writeFileSync(path.join(dir, 'src', 'a.ts'), '')
    writeFileSync(path.join(dir, 'src', 'b.js'), '')
    const r = await globTool.run({ pattern: 'src/*.ts' }, ctx)
    expect(r.output).toContain('src/a.ts')
    expect(r.output).not.toContain('src/b.js')
  })
})

describe('grep', () => {
  it('finds matching lines with file:line', async () => {
    mkdirSync(path.join(dir, 'lib'))
    writeFileSync(path.join(dir, 'lib', 'x.ts'), 'const foo = 1\nconst bar = 2\n')
    const r = await grepTool.run({ pattern: 'foo', include: ['**/*.ts'] }, ctx)
    expect(r.output).toContain('x.ts:1')
    expect(r.output).not.toContain('bar')
  })
})

describe('apply-patch tool', () => {
  it('creates and edits files through the tool', async () => {
    writeFileSync(path.join(dir, 'f.txt'), 'a\nb\nc\n')
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -2,1 +2,1 @@',
      '-b',
      '+B',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,1 @@',
      '+fresh'
    ].join('\n') + '\n'
    const r = await applyPatchTool.run({ patch }, ctx)
    expect(r.output).toContain('updated f.txt')
    expect(r.output).toContain('created new.txt')
    const fs = await import('node:fs')
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf-8')).toBe('a\nB\nc\n')
    expect(fs.readFileSync(path.join(dir, 'new.txt'), 'utf-8')).toBe('fresh\n')
  })
})

describe('todowrite', () => {
  it('stores todos via ctx.setTodos and returns them as json', async () => {
    const saved: Array<{ content: string; status: string }> = []
    const todoCtx: ToolContext = { cwd: '', ask: async () => null, setTodos: (t) => saved.push(...t) }
    const r = await todowriteTool.run({
      todos: [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'pending', priority: 'high' }
      ]
    }, todoCtx)
    expect(r.output).toContain('"a"')
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ content: 'a', status: 'in_progress' })
    expect(saved[1]).toMatchObject({ content: 'b', status: 'pending', priority: 'high' })
  })
})

describe('question', () => {
  it('returns the user answer via ctx.ask', async () => {
    const r = await questionTool.run({ question: 'what is your name?' }, ctx)
    expect(r.output).toContain('meow')
  })

  it('forwards options to ctx.ask and returns the selected label', async () => {
    const optCtx: ToolContext = {
      cwd: '',
      ask: async (q) => (q.options?.some(o => o.label === 'Plan') ? 'Plan' : null)
    }
    const r = await questionTool.run({
      question: 'Which mode?',
      options: [{ label: 'Build', description: 'make changes' }, { label: 'Plan', description: 'read-only' }],
      multiple: true
    }, optCtx)
    expect(r.output).toContain('Plan')
  })

  it('errors when the user does not answer', async () => {
    const r = await questionTool.run({ question: 'unanswered' }, ctx)
    expect(r.error).toMatch(/did not answer/)
  })
})
