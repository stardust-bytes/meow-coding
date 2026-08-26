import { describe, expect, it } from 'vitest'
import { usableContextTokens, fitHeadToBudget, selectHeadTail, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, truncateToolOutput, serializeItems, pruneToolOutputs, hardTruncate } from '../../src/main/agent/compact'
import { estimateTokens, estimateUsage } from '../../src/main/agent/token'
import type { TranscriptItem } from '../../src/main/agent/message'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'
import type { LlmClient, LlmStreamPart } from '../../src/main/agent/llm'

function msg(role: ChatMessage['role'], text: string): TranscriptItem {
  return { kind: 'message', message: { id: Math.random().toString(36), role, text, createdAt: 1 } }
}
function tool(text: string): TranscriptItem {
  const t: ToolCallData = { id: 't', tool: 'bash', input: {}, permission: 'allowed', output: text }
  return { kind: 'tool', tool: t }
}

describe('selectHeadTail', () => {
  it('keeps the recent tail turns and summarizes the older head', () => {
    const items = [
      msg('user', 'old prompt'),
      msg('assistant', 'old answer'),
      msg('user', 'recent prompt'),
      msg('assistant', 'recent answer'),
      msg('user', 'latest prompt')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 2)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'old prompt')).toBe(true)
    expect(tail.some(i => i.kind === 'message' && i.message.text === 'latest prompt')).toBe(true)
    expect(tail[0].kind === 'message' && tail[0].message.role === 'user').toBe(true)
  })

  it('returns everything as head when tailTurns is 0', () => {
    const items = [msg('user', 'a'), msg('user', 'b')]
    const { head, tail } = selectHeadTail(items, 100, 0)
    expect(head).toHaveLength(2)
    expect(tail).toHaveLength(0)
  })

  it('ignores the compaction marker user message when counting turns', () => {
    const items = [
      { kind: 'message' as const, message: { id: 's', role: 'user' as const, text: COMPACTION_MARKER, createdAt: 1 } },
      { kind: 'message' as const, message: { id: 'sa', role: 'assistant' as const, text: 'summary', createdAt: 1 } },
      msg('user', 'real question'),
      msg('assistant', 'answer')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 1)
    expect(head).toHaveLength(0)
    expect(tail).toHaveLength(2)
    expect(tail[0].kind === 'message' && tail[0].message.text === 'real question').toBe(true)
  })

  it('excludes a prior compaction pair from the head', () => {
    const items = [
      { kind: 'message' as const, message: { id: 's', role: 'user' as const, text: COMPACTION_MARKER, createdAt: 1 } },
      { kind: 'message' as const, message: { id: 'sa', role: 'assistant' as const, text: 'summary', createdAt: 1 } },
      msg('user', 'old question'),
      msg('assistant', 'old answer'),
      msg('user', 'recent question')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 1)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'summary')).toBe(false)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'old question')).toBe(true)
    expect(tail.some(i => i.kind === 'message' && i.message.text === 'recent question')).toBe(true)
  })
})

describe('serializeItems / truncateToolOutput', () => {
  it('serializes messages and tool calls into prompt text', () => {
    const items: TranscriptItem[] = [
      msg('user', 'hello'),
      { kind: 'tool', tool: { id: 't', tool: 'bash', input: { command: 'ls' }, permission: 'allowed', output: 'a\nb\nc\n'.repeat(20) } }
    ]
    const text = serializeItems(items, 5)
    expect(text).toContain('[User]: hello')
    expect(text).toContain('[Assistant tool call]: bash({"command":"ls"})')
    expect(text).toContain('[truncated]')
  })

  it('truncateToolOutput keeps short outputs unchanged', () => {
    expect(truncateToolOutput('short', 100)).toBe('short')
    expect(truncateToolOutput('x'.repeat(300), 200)).toMatch(/\[truncated\]/)
  })
})

describe('buildCompactionPrompt', () => {
  it('creates a fresh summary prompt without a previous summary', () => {
    const prompt = buildCompactionPrompt(undefined, '[User]: hi')
    expect(prompt).toContain('Create a new anchored summary')
    expect(prompt).toContain('## Objective')
    expect(prompt).toContain('[User]: hi')
  })

  it('requests an update when a previous summary exists', () => {
    const prompt = buildCompactionPrompt('old summary', '[User]: hi')
    expect(prompt).toContain('Update the anchored summary')
    expect(prompt).toContain('<previous-summary>\nold summary\n</previous-summary>')
  })
})

describe('compactTranscript', () => {
  function stubLlm(parts: LlmStreamPart[]): LlmClient {
    return {
      async *stream(): AsyncGenerator<LlmStreamPart> {
        for (const p of parts) yield p
      }
    }
  }

  it('returns the concatenated summary text', async () => {
    const llm = stubLlm([
      { kind: 'text', text: '## Objective' },
      { kind: 'text', text: '\n- build the feature' },
      { kind: 'finish' }
    ])
    const summary = await compactTranscript({ llm, model: 'm', prompt: 'summarize' })
    expect(summary).toBe('## Objective\n- build the feature')
  })

  it('returns null on an llm error part', async () => {
    const llm = stubLlm([{ kind: 'error', error: 'boom' }])
    expect(await compactTranscript({ llm, model: 'm', prompt: 'summarize' })).toBeNull()
  })

  it('returns null on an empty result', async () => {
    const llm = stubLlm([{ kind: 'finish' }])
    expect(await compactTranscript({ llm, model: 'm', prompt: 'summarize' })).toBeNull()
  })

  it('returns null when aborted mid-stream', async () => {
    const controller = new AbortController()
    const llm: LlmClient = {
      async *stream(): AsyncGenerator<LlmStreamPart> {
        yield { kind: 'text', text: 'partial' }
        controller.abort()
      }
    }
    expect(await compactTranscript({ llm, model: 'm', prompt: 'x', signal: controller.signal })).toBeNull()
  })
})

describe('pruneToolOutputs', () => {
  const cfg = { auto: true, buffer: 100, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }

  it('clears outputs of old tool calls beyond the recent turns', () => {
    const items: TranscriptItem[] = [
      msg('user', 'u0'),
      msg('assistant', 'a0'),
      tool('P'.repeat(50000)),
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2')
    ]
    const changed = pruneToolOutputs(items, cfg)
    expect(changed).toBe(true)
    const toolItem = items.find(i => i.kind === 'tool')
    expect(toolItem && toolItem.kind === 'tool' ? toolItem.tool.output : 'kept').toBeUndefined()
    expect(toolItem && toolItem.kind === 'tool' ? toolItem.tool.error : '').toContain('cleared')
  })

  it('does nothing when prune is disabled', () => {
    const items: TranscriptItem[] = [
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      tool('P'.repeat(50000)),
      msg('user', 'u2')
    ]
    expect(pruneToolOutputs(items, { ...cfg, prune: false })).toBe(false)
    const toolItem = items.find(i => i.kind === 'tool')
    expect(toolItem && toolItem.kind === 'tool' ? toolItem.tool.output : '').toContain('P')
  })

  it('protects skill tool outputs and recent turns', () => {
    const skillItem: ToolCallData = { id: 's', tool: 'skill', input: {}, permission: 'allowed', output: 'S'.repeat(100000) }
    const items: TranscriptItem[] = [
      msg('user', 'u0'),
      msg('assistant', 'a0'),
      { kind: 'tool', tool: skillItem },
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2')
    ]
    expect(pruneToolOutputs(items, cfg)).toBe(false)
    expect(skillItem.output).toBe('S'.repeat(100000))
  })

  it('returns false when reclaimable space is below the minimum', () => {
    const items: TranscriptItem[] = [
      msg('user', 'u0'),
      msg('assistant', 'a0'),
      tool('P'.repeat(25000)),
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2')
    ]
    expect(pruneToolOutputs(items, cfg)).toBe(false)
  })
})

describe('hardTruncate', () => {
  it('clears tool outputs to get the transcript under the target', () => {
    const items = [msg('user', 'q'), msg('assistant', 'a'), tool('x'.repeat(20000))]
    const out = hardTruncate(items, 2000)
    const t = out.find(i => i.kind === 'tool')
    expect(t?.kind === 'tool' && t.tool.output).toBeUndefined()
    expect(t?.kind === 'tool' && t.tool.error).toBe('[Old tool result content cleared]')
    expect(estimateUsage(out)).toBeLessThan(2000)
  })

  it('drops the oldest turns when clearing tool outputs is not enough', () => {
    const items = [
      msg('user', 'old ' + 'x'.repeat(20000)),
      msg('assistant', 'old answer'),
      msg('user', 'recent question'),
      msg('assistant', 'recent answer')
    ]
    const out = hardTruncate(items, 2000)
    expect(out.some(i => i.kind === 'message' && i.message.text.startsWith('old '))).toBe(false)
    expect(out.some(i => i.kind === 'message' && i.message.text === 'recent question')).toBe(true)
    expect(estimateUsage(out)).toBeLessThan(2000)
  })

  it('keeps the last turn even when it alone exceeds the target', () => {
    const items = [msg('user', 'huge ' + 'x'.repeat(50000))]
    const out = hardTruncate(items, 100)
    expect(out).toHaveLength(1)
  })

  it('leaves a transcript that already fits untouched', () => {
    const items = [msg('user', 'small'), msg('assistant', 'ok')]
    expect(hardTruncate(items, 100000)).toEqual(items)
  })

  it('does not mutate the items it was given', () => {
    const items = [msg('user', 'q'), msg('assistant', 'a'), tool('x'.repeat(20000))]
    hardTruncate(items, 2000)
    const original = items.find(i => i.kind === 'tool')
    expect(original?.kind === 'tool' && original.tool.output).toBe('x'.repeat(20000))
  })
})

describe('usableContextTokens', () => {
  it('reserves both the compaction buffer and the output budget', () => {
    expect(usableContextTokens(200000, 20000, 32000)).toBe(148000)
  })

  it('treats a missing output reserve as zero', () => {
    expect(usableContextTokens(200000, 20000)).toBe(180000)
  })
})

describe('fitHeadToBudget', () => {
  it('leaves a head that already fits alone', () => {
    const head = [msg('user', 'q'), msg('assistant', 'a')]
    expect(fitHeadToBudget(head, 100000, 2000)).toEqual(head)
  })

  it('drops the oldest turns until the summary prompt fits', () => {
    const head = [
      msg('user', 'oldest ' + 'x'.repeat(20000)),
      msg('assistant', 'a1'),
      msg('user', 'middle ' + 'y'.repeat(20000)),
      msg('assistant', 'a2'),
      msg('user', 'newest'),
      msg('assistant', 'a3')
    ]
    const out = fitHeadToBudget(head, 2000, 2000)
    expect(out.some(i => i.kind === 'message' && i.message.text.startsWith('oldest'))).toBe(false)
    expect(out.some(i => i.kind === 'message' && i.message.text === 'newest')).toBe(true)
    expect(estimateTokens(serializeItems(out, 2000))).toBeLessThanOrEqual(2000)
  })

  it('still shrinks a head made of one oversized turn', () => {
    const head = [msg('user', 'only turn'), msg('assistant', 'z'.repeat(80000))]
    const out = fitHeadToBudget(head, 500, 2000)
    expect(estimateTokens(serializeItems(out, 2000))).toBeLessThanOrEqual(500)
  })

  it('gives up on an empty head rather than looping', () => {
    expect(fitHeadToBudget([], 10, 2000)).toEqual([])
  })
})

describe('pruneToolOutputs context scaling', () => {
  const cfg = { auto: true, buffer: 100, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }

  function transcript() {
    return [
      msg('user', 'u0'),
      msg('assistant', 'a0'),
      tool('P'.repeat(120000)),
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2')
    ]
  }

  it('prunes that output on a 128k model', () => {
    const items = transcript()
    expect(pruneToolOutputs(items, cfg, 128000)).toBe(true)
  })

  it('leaves the same output alone on a million-token model', () => {
    const items = transcript()
    expect(pruneToolOutputs(items, cfg, 1_000_000)).toBe(false)
    const toolItem = items.find(i => i.kind === 'tool')
    expect(toolItem && toolItem.kind === 'tool' ? toolItem.tool.output : '').toContain('P')
  })
})
