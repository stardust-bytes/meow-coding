const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

export function estimateUsage(value: unknown): number {
  return estimateTokens(JSON.stringify(value))
}
