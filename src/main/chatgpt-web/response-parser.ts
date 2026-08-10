import { randomUUID } from 'node:crypto'
import type { LlmStreamPart } from '../agent/llm'
import { CHATGPT_WEB_TOOL_CALL_FENCE } from './prompt'

const FENCE_RE = new RegExp('```' + CHATGPT_WEB_TOOL_CALL_FENCE + '\\n([\\s\\S]*?)\\n```', 'g')

export function parseChatGptWebResponse(markdown: string): LlmStreamPart[] {
  if (!markdown.trim()) return []

  const parts: LlmStreamPart[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    const before = markdown.slice(cursor, match.index).trim()
    const body = match[1]
    let parsed: { name?: string; input?: Record<string, unknown> } | null = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }

    if (parsed && typeof parsed.name === 'string') {
      if (before) parts.push({ kind: 'text', text: before })
      parts.push({
        kind: 'tool-call',
        toolName: parsed.name,
        toolCallId: randomUUID(),
        toolInput: parsed.input ?? {}
      })
    } else {
      // Not a valid tool_call payload — keep the whole fenced block as text
      // instead of throwing the turn away.
      const raw = markdown.slice(cursor, FENCE_RE.lastIndex).trim()
      if (raw) parts.push({ kind: 'text', text: raw })
    }
    cursor = FENCE_RE.lastIndex
  }

  const rest = markdown.slice(cursor).trim()
  if (rest) parts.push({ kind: 'text', text: rest })

  return parts
}
