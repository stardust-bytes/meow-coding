import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { toLlmMessages, toToolDefinition } from '../../src/main/agent/message'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'
import type { ToolDefinition } from '../../src/main/agent/tools/types'

function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: 'm-' + Math.random(), role, text, createdAt: 1 }
}

function toolCall(tool: string, input: Record<string, unknown>, id = 'c1'): ToolCallData {
  return { id, tool, input, permission: 'allowed' }
}

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
