import type { MessageTokens } from './types'

// Mỗi provider quy ước totalTokens một kiểu (Anthropic tách cache read khỏi
// input_tokens, OpenAI gộp sẵn), nên ta tin totalTokens khi có và chỉ tự cộng
// khi provider không trả. Breakdown được lưu trong MessageTokens để sau này
// chỉnh công thức ở đúng một chỗ.
export function contextTokens(u: MessageTokens): number {
  return u.total > 0 ? u.total : u.input + u.output
}

export function contextPercent(tokens: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null
  return Math.round((tokens / limit) * 100)
}

export type ContextLevel = 'normal' | 'warn' | 'danger'

export function contextLevel(tokens: number, compactThreshold: number | null): ContextLevel {
  if (!compactThreshold || compactThreshold <= 0) return 'normal'
  if (tokens >= compactThreshold) return 'danger'
  if (tokens >= compactThreshold * 0.8) return 'warn'
  return 'normal'
}
