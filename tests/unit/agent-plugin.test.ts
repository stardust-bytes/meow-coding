import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadUserTools } from '../../src/main/agent/plugin'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-tools-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ctx: ToolContext = { cwd: '/proj', ask: async () => null }

describe('loadUserTools', () => {
  it('loads a user tool module from a .js file', async () => {
    writeFileSync(path.join(dir, 'greet.js'), [
      'module.exports = {',
      '  name: "greet",',
      '  description: "Say hello",',
      '  schema: { type: "object", properties: { who: { type: "string" } } },',
      '  run: async (input) => ({ output: "hello " + (input.who ?? "world") })',
      '}'
    ].join('\n'))
    const tools = await loadUserTools([dir])
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('greet')
    const r = await tools[0].run({ who: 'meow' }, ctx)
    expect(r.output).toBe('hello meow')
  })

  it('derives the name from the filename when missing', async () => {
    writeFileSync(path.join(dir, 'uppercase.js'), [
      'module.exports = { run: async (input) => ({ output: String(input.text ?? "").toUpperCase() }) }'
    ].join('\n'))
    const tools = await loadUserTools([dir])
    expect(tools[0].name).toBe('uppercase')
    const r = await tools[0].run({ text: 'hi' }, ctx)
    expect(r.output).toBe('HI')
  })

  it('ignores a missing directory', async () => {
    const tools = await loadUserTools([path.join(dir, 'nope')])
    expect(tools).toEqual([])
  })
})
