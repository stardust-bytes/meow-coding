import { describe, expect, it } from 'vitest'
import { parseChatGptWebResponse } from '../../src/main/chatgpt-web/response-parser'

describe('parseChatGptWebResponse', () => {
  it('returns a single text part for plain markdown', () => {
    const parts = parseChatGptWebResponse('Hello, this is plain text.')
    expect(parts).toEqual([{ kind: 'text', text: 'Hello, this is plain text.' }])
  })

  it('extracts a tool_call block into a tool-call part', () => {
    const md = 'Sure, let me check.\n\n```tool_call\n{"name": "bash", "input": {"command": "ls"}}\n```\n'
    const parts = parseChatGptWebResponse(md)
    expect(parts[0]).toEqual({ kind: 'text', text: 'Sure, let me check.' })
    expect(parts[1].kind).toBe('tool-call')
    expect(parts[1].toolName).toBe('bash')
    expect(parts[1].toolInput).toEqual({ command: 'ls' })
    expect(typeof parts[1].toolCallId).toBe('string')
    expect(parts[1].toolCallId!.length).toBeGreaterThan(0)
  })

  it('supports multiple tool_call blocks interleaved with text', () => {
    const md = [
      'First I will read the file.',
      '```tool_call',
      '{"name": "read", "input": {"path": "a.txt"}}',
      '```',
      'Now let me check another one.',
      '```tool_call',
      '{"name": "read", "input": {"path": "b.txt"}}',
      '```'
    ].join('\n')
    const parts = parseChatGptWebResponse(md)
    const toolParts = parts.filter(p => p.kind === 'tool-call')
    expect(toolParts).toHaveLength(2)
    expect(toolParts[0].toolInput).toEqual({ path: 'a.txt' })
    expect(toolParts[1].toolInput).toEqual({ path: 'b.txt' })
  })

  it('falls back to treating an unparseable tool_call block as plain text', () => {
    const md = 'Oops:\n```tool_call\nnot valid json\n```'
    const parts = parseChatGptWebResponse(md)
    expect(parts.some(p => p.kind === 'tool-call')).toBe(false)
    expect(parts.map(p => p.text).join('')).toContain('not valid json')
  })

  it('returns an empty array for empty input', () => {
    expect(parseChatGptWebResponse('')).toEqual([])
  })
})
