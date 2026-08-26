import type { LiveModelInfo } from '../models-catalog'

// Field của response /models OpenAI-compatible có thể mang context/output dưới
// nhiều tên khác nhau (Ollama Cloud, các proxy); mỗi danh sách thử theo thứ tự.
const CONTEXT_FIELDS = ['context_window', 'max_context_length', 'context_length'] as const
const OUTPUT_FIELDS = ['max_output_tokens', 'max_tokens', 'output_tokens'] as const

export function parseLiveModelsInfo(body: unknown): LiveModelInfo[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: LiveModelInfo[] = []
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue
    const m = raw as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id) continue
    const context = firstNumber(m, CONTEXT_FIELDS)
    const output = firstNumber(m, OUTPUT_FIELDS)
    out.push({
      id: m.id,
      ...(context !== undefined ? { context } : {}),
      ...(output !== undefined ? { output } : {})
    })
  }
  return out
}

function firstNumber(m: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const value = m[field]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

// Server-side model tag có thể lệch với id cấu hình (Ollama Cloud phục vụ
// `deepseek-v4-flash:0731` trong khi config/catalog nói `deepseek-v4-flash`).
// Bỏ :tag trước, rồi containment cho id có namespace (Fireworks).
export function matchModel(liveId: string, modelId: string): boolean {
  if (liveId === modelId) return true
  const stripTag = (id: string) => id.split(':')[0]
  if (stripTag(liveId) === stripTag(modelId)) return true
  if (liveId.includes(modelId) || modelId.includes(liveId)) return true
  return false
}

const CONTEXT_OVERFLOW_PATTERNS = [
  'prompt is too long',
  'context length exceeded',
  'maximum context length',
  'context_length_exceeded',
  'exceeds the context window',
  'please reduce the length of the messages'
] as const

export function classifyContextOverflowError(message: string | undefined): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => lower.includes(pattern))
}

/**
 * Trần context thật mà provider đích danh trong message reject, khi có.
 * Ngược lại undefined — caller rơi về cỡ prompt bị reject làm trần.
 */
export function parseContextLimitFromError(message: string | undefined): number | undefined {
  if (!message) return undefined
  // OpenAI: "This model's maximum context length is 128000 tokens"
  const maxContext = message.match(/maximum\s+context\s+(?:length|window)[^\d]*(\d+)/i)
  if (maxContext) return Number(maxContext[1])
  // Anthropic: "prompt is too long: 19000 tokens > 16000 maximum"
  const tooLong = message.match(/tokens?\s*[>≥]+\s*(\d+)\s*maximum/i)
  if (tooLong) return Number(tooLong[1])
  // Generic: "maximum is 128000" / "max: 128000"
  const maxIs = message.match(/\bmax(?:imum)?\s*(?:is|:)\s*(\d+)/i)
  if (maxIs) return Number(maxIs[1])
  return undefined
}
