import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { normalizeToolInput, toLlmMessages, toToolDefinition } from '../../src/main/agent/message'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'
import type { ToolDefinition } from '../../src/main/agent/tools/types'

function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: 'm-' + Math.random(), role, text, createdAt: 1 }
}

function toolCall(tool: string, input: Record<string, unknown>, id = 'c1'): ToolCallData {
  return { id, tool, input, permission: 'allowed' }
}

describe('normalizeToolInput', () => {
  it('passes plain objects through unchanged', () => {
    expect(normalizeToolInput({ a: 1 })).toEqual({ a: 1 })
  })

  it('parses a valid JSON string into an object', () => {
    expect(normalizeToolInput('{"pattern":"**/*.ts"}')).toEqual({ pattern: '**/*.ts' })
  })

  it('returns {} for malformed JSON strings instead of double-encoding them', () => {
    expect(normalizeToolInput('{"co')).toEqual({})
    expect(normalizeToolInput('')).toEqual({})
    expect(normalizeToolInput('   ')).toEqual({})
  })

  it('returns {} for arrays, scalars, and null', () => {
    expect(normalizeToolInput('[1,2]')).toEqual({})
    expect(normalizeToolInput('42')).toEqual({})
    expect(normalizeToolInput(null)).toEqual({})
    expect(normalizeToolInput(undefined)).toEqual({})
  })
})

describe('toLlmMessages', () => {
  it('converts a simple user/assistant exchange', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'hi') },
      { kind: 'message' as const, message: msg('assistant', 'hello') }
    ]
    const llm = toLlmMessages(items)
    expect(llm).toHaveLength(2)
    expect(llm[0]).toEqual({ role: 'user', content: 'hi' })
    expect(llm[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'hello' }] })
  })

  it('attaches tool calls to the preceding assistant message and emits tool results after it', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'list files') },
      { kind: 'message' as const, message: msg('assistant', 'reading...') },
      { kind: 'tool' as const, tool: toolCall('glob', { pattern: '**/*.ts' }) },
      { kind: 'message' as const, message: msg('assistant', 'done') }
    ]
    const llm = toLlmMessages(items)
    expect(llm).toHaveLength(4)
    const assistant = llm[1] as { role: 'assistant'; content: unknown[] }
    const toolResult = llm[2] as { role: 'tool'; content: unknown[] }
    expect(assistant.content).toEqual([
      { type: 'text', text: 'reading...' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'glob', input: { pattern: '**/*.ts' } }
    ])
    expect(toolResult.role).toBe('tool')
  })

  it('replays string tool inputs as parsed objects (no double-encoding)', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'read a file') },
      { kind: 'message' as const, message: msg('assistant', '') },
      { kind: 'tool' as const, tool: { ...toolCall('read', { file_path: 'a.ts' }, 'tc1'), input: '{"file_path":"a.ts"}' } },
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}, 'tc2'), input: '{"co' } },
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}, 'tc3'), input: '' } }
    ]
    const llm = toLlmMessages(items)
    const assistant = llm[1] as { role: 'assistant'; content: Array<{ type: string; input: unknown }> }
    expect(assistant.content.filter(c => c.type === 'tool-call').map(c => c.input)).toEqual([
      { file_path: 'a.ts' },
      {},
      {}
    ])
  })

  it('uses tool output and falls back to error/ok', () => {
    const base = [
      { kind: 'message' as const, message: msg('user', 'x') },
      { kind: 'message' as const, message: msg('assistant', '') }
    ]
    const withOutput = toLlmMessages([
      ...base,
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}), output: 'res' } }
    ])
    const withError = toLlmMessages([
      ...base,
      { kind: 'tool' as const, tool: { ...toolCall('bash', {}), error: 'boom' } }
    ])
    const withNone = toLlmMessages([...base, { kind: 'tool' as const, tool: toolCall('bash', {}) }])
    expect((withOutput[2] as { content: { output: { type: string; value: unknown } }[] }).content[0].output)
      .toEqual({ type: 'text', value: 'res' })
    expect((withError[2] as { content: { output: { type: string; value: unknown } }[] }).content[0].output)
      .toEqual({ type: 'error-text', value: 'boom' })
    expect((withNone[2] as { content: { output: { type: string; value: unknown } }[] }).content[0].output)
      .toEqual({ type: 'text', value: 'ok' })
  })

  it('orders tool results after the assistant message that produced them', () => {
    const items = [
      { kind: 'message' as const, message: msg('user', 'go') },
      { kind: 'message' as const, message: msg('assistant', 'a') },
      { kind: 'tool' as const, tool: toolCall('read', {}, 't1') },
      { kind: 'tool' as const, tool: toolCall('read', {}, 't2') },
      { kind: 'message' as const, message: msg('assistant', 'b') }
    ]
    const llm = toLlmMessages(items)
    expect(llm).toHaveLength(5)
    expect((llm[1] as { content: { toolCallId: string }[] }).content
      .filter(p => p.type === 'tool-call').map(p => p.toolCallId))
      .toEqual(['t1', 't2'])
  })

  it('drops orphan tool items that have no preceding assistant message', () => {
    // A tool item can end up orphaned when an aborted tool's result is
    // appended after the next turn's user message. Replaying it as a "tool"
    // message with no preceding assistant tool_calls makes providers reject
    // the whole conversation with a 400, so it must be skipped.
    const items = [
      { kind: 'message' as const, message: msg('user', 'first') },
      { kind: 'message' as const, message: msg('assistant', '') },
      { kind: 'tool' as const, tool: toolCall('bash', { command: 'x' }, 't1') },
      { kind: 'message' as const, message: msg('user', 'second') },
      { kind: 'tool' as const, tool: toolCall('bash', { command: 'y' }, 't2') },
      { kind: 'message' as const, message: msg('assistant', 'done') },
      { kind: 'tool' as const, tool: toolCall('read', {}, 't3') }
    ]
    const llm = toLlmMessages(items)
    const toolMsgs = llm.filter(m => m.role === 'tool')
    // t1 and t3 pair with their assistant messages; the orphan t2 is dropped.
    expect(toolMsgs).toHaveLength(2)
    const ids = toolMsgs.map(m => (m.content as { toolCallId: string }[])[0].toolCallId)
    expect(ids).toEqual(['t1', 't3'])
    // Every tool message must follow an assistant message carrying tool_calls.
    for (let i = 0; i < llm.length; i++) {
      if (llm[i].role !== 'tool') continue
      const prev = llm[i - 1]
      expect(prev && prev.role === 'assistant').toBe(true)
      expect((prev as { content: { type: string }[] }).content.some(p => p.type === 'tool-call')).toBe(true)
    }
  })

  it('drops a tool item that leads the transcript (no assistant at all)', () => {
    const items = [
      { kind: 'tool' as const, tool: toolCall('bash', { command: 'x' }, 't0') },
      { kind: 'message' as const, message: msg('user', 'hi') }
    ]
    const llm = toLlmMessages(items)
    expect(llm).toHaveLength(1)
    expect(llm[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('emits image parts for user message with images', () => {
    const items: TranscriptItem[] = [{
      kind: 'message',
      message: {
        id: '1', role: 'user', text: 'fix this', createdAt: 0,
        images: [{ id: 'i1', name: 'a.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAA', size: 3 }]
      }
    }]
    const msgs = toLlmMessages(items)
    const content = msgs[0].content
    expect(Array.isArray(content)).toBe(true)
    expect((content as Array<{ type: string; text?: string; image?: string }>)[0]).toMatchObject({ type: 'text', text: 'fix this' })
    expect((content as Array<{ type: string; image?: string }>)[1]).toMatchObject({ type: 'image', image: 'data:image/png;base64,AAA' })
  })
})

describe('toToolDefinition', () => {
  it('wraps a ToolDefinition into an AI SDK tool', () => {
    const def: ToolDefinition = {
      name: 'read',
      description: 'Read a file',
      schema: { parse: () => ({ file_path: 'a' }) } as unknown as z.ZodType<Record<string, unknown>>,
      run: async () => ({ output: 'x' })
    }
    const t = toToolDefinition(def)
    expect(typeof t).toBe('object')
    expect((t as { description?: string }).description).toBe('Read a file')
  })
})
