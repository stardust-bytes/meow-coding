// Dense JSON transcripts (tool calls/outputs) tokenize near 3.5 chars/token;
// 4 was an underestimate that delayed compaction and kept more context alive.
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

export function estimateUsage(value: unknown): number {
  return estimateTokens(JSON.stringify(value))
}
