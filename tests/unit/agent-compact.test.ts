import { describe, expect, it } from 'vitest'
import { pruneTranscript } from '../../src/main/agent/compact'
import type { TranscriptItem } from '../../src/main/agent/message'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'

function msg(role: ChatMessage['role'], text: string): TranscriptItem {
  return { kind: 'message', message: { id: Math.random().toString(36), role, text, createdAt: 1 } }
}
function tool(text: string): TranscriptItem {
  const t: ToolCallData = { id: 't', tool: 'bash', input: {}, permission: 'allowed', output: text }
  return { kind: 'tool', tool: t }
}

describe('pruneTranscript', () => {
  it('returns items unchanged when under budget', () => {
    const items = [msg('user', 'hi'), msg('assistant', 'hello')]
    expect(pruneTranscript(items, 10000)).toEqual(items)
  })

  it('drops the oldest content when over budget but keeps the latest user message', () => {
    const items = [
      msg('user', 'a'.repeat(2000)),
      msg('assistant', 'b'.repeat(2000)),
      msg('user', 'latest question')
    ]
    const pruned = pruneTranscript(items, 2000)
    const texts = pruned.filter(i => i.kind === 'message').map(i => i.message.text)
    expect(texts).not.toContain('a'.repeat(2000))
    expect(texts[texts.length - 1]).toBe('latest question')
  })

  it('strips leading orphan tool items', () => {
    const items = [tool('old'), msg('user', 'x'), msg('assistant', 'y')]
    const pruned = pruneTranscript(items, 20)
    expect(pruned.length).toBeGreaterThan(0)
    expect(pruned[0].kind).toBe('message')
  })

  it('ignores maxChars <= 0', () => {
    const items = [msg('user', 'x')]
    expect(pruneTranscript(items, 0)).toEqual(items)
  })

  it('truncates a single oversized item instead of dropping everything', () => {
    const items = [
      msg('user', 'read the plan'),
      msg('assistant', ''),
      tool('P'.repeat(50000))
    ]
    const pruned = pruneTranscript(items, 30000)
    const keptTool = pruned.find(i => i.kind === 'tool') as { kind: 'tool'; tool: ToolCallData } | undefined
    expect(keptTool).toBeDefined()
    expect(keptTool!.tool.output!.length).toBeLessThan(30000)
    expect(keptTool!.tool.output!.length).toBeGreaterThan(0)
  })

  it('keeps the latest user message when the newest item is oversized', () => {
    const items = [
      tool('P'.repeat(50000)),
      msg('user', 'latest question')
    ]
    const pruned = pruneTranscript(items, 30000)
    const texts = pruned.filter(i => i.kind === 'message').map(i => (i as { message: ChatMessage }).message.text)
    expect(texts[texts.length - 1]).toBe('latest question')
  })
})
