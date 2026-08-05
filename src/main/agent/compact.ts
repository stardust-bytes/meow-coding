import type { TranscriptItem } from './message'
import type { LlmClient, LlmStreamOptions } from './llm'
import { estimateUsage } from './token'

// ---------------------------------------------------------------------------
// Token-based compaction (modeled on opencode session/compaction.ts)
// ---------------------------------------------------------------------------

export interface CompactionSettings {
  auto: boolean
  buffer: number
  keepTokens: number
  tailTurns: number
  toolOutputMaxChars: number
}

export const COMPACTION_MARKER = 'What did we do so far?'

type Turn = { start: number; end: number }

function turns(items: TranscriptItem[]): Turn[] {
  const result: Turn[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'message' || item.message.role !== 'user') continue
    if (item.message.text === COMPACTION_MARKER) continue
    result.push({ start: i, end: items.length })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

// A prior compaction is stored as a marker user message plus the summary as the
// next assistant message. When re-compacting, that pair is not re-summarized:
// the summary is passed separately as previousSummary.
function stripCompactionPairs(items: TranscriptItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = []
  let skipNext = false
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'message' && item.message.role === 'user' && item.message.text === COMPACTION_MARKER) {
      skipNext = true
      continue
    }
    if (skipNext && item.kind === 'message' && item.message.role === 'assistant') {
      skipNext = false
      continue
    }
    skipNext = false
    out.push(item)
  }
  return out
}

export function selectHeadTail(
  items: TranscriptItem[],
  keepTokens: number,
  tailTurns: number
): { head: TranscriptItem[]; tail: TranscriptItem[] } {
  if (tailTurns <= 0) return { head: items, tail: [] }
  const all = turns(items)
  if (all.length === 0) return { head: items, tail: [] }
  const recent = all.slice(-tailTurns)
  let tailStart = recent[0].start
  let total = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]
    const size = estimateUsage(items.slice(turn.start, turn.end))
    if (total + size <= keepTokens || total === 0) {
      total += size
      tailStart = turn.start
    } else {
      break
    }
  }
  return { head: stripCompactionPairs(items.slice(0, tailStart)), tail: items.slice(tailStart) }
}

function serializeItem(item: TranscriptItem, toolOutputMaxChars: number): string | null {
  if (item.kind === 'message') {
    if (item.message.role === 'user') return `[User]: ${item.message.text}`
    const reasoning = item.message.reasoning ? `\n[Assistant reasoning]: ${item.message.reasoning}` : ''
    return `[Assistant]: ${item.message.text}${reasoning}`
  }
  const call = item.tool
  const input = JSON.stringify(call.input ?? {})
  if (call.error) return `[Assistant tool call]: ${call.tool}(${input})\n[Tool error]: ${call.error}`
  if (call.output !== undefined) {
    const out = truncateToolOutput(call.output, toolOutputMaxChars)
    return `[Assistant tool call]: ${call.tool}(${input})\n[Tool result]: ${out}`
  }
  return `[Assistant tool call]: ${call.tool}(${input})`
}

export function truncateToolOutput(value: string, maxChars: number): string {
  if (maxChars <= 0) return value
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`
}

export function serializeItems(items: TranscriptItem[], toolOutputMaxChars = 2000): string {
  return items
    .map(item => serializeItem(item, toolOutputMaxChars))
    .filter((s): s is string => Boolean(s))
    .join('\n\n')
}

export const COMPACTION_SYSTEM =
  'You are an anchored context summarization assistant for coding sessions.\n\n' +
  'Summarize only the conversation history you are given. The newest turns may be kept verbatim outside ' +
  'your summary, so focus on the older context that still matters for continuing the work.\n\n' +
  'If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it ' +
  'with the new history by preserving still-true details, removing stale details, and merging in new facts.\n\n' +
  'Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact ' +
  'file paths and identifiers when known, and prefer terse bullets over paragraphs.\n\n' +
  'Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging ' +
  'context. Respond in the same language as the conversation.'

const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

export function buildCompactionPrompt(previousSummary: string | undefined, headText: string): string {
  return [
    previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${previousSummary}\n</previous-summary>`
      : 'Create a new anchored summary from the conversation history.',
    SUMMARY_TEMPLATE,
    headText
  ].join('\n\n')
}

export interface CompactDeps {
  llm: LlmClient
  model: string
  prompt: string
  signal?: AbortSignal
}

// Runs the compaction LLM call. Returns the summary text or null on failure.
export async function compactTranscript(deps: CompactDeps): Promise<string | null> {
  const { llm, model, prompt, signal } = deps
  const options: LlmStreamOptions = {
    model,
    system: COMPACTION_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    signal
  }
  try {
    let text = ''
    for await (const part of llm.stream(options)) {
      if (signal?.aborted) return null
      if (part.kind === 'text') text += part.text
      if (part.kind === 'error') return null
    }
    if (signal?.aborted) return null
    return text.trim() || null
  } catch {
    return null
  }
}
