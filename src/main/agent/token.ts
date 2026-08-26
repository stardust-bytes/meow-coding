// Dense JSON transcripts (tool calls/outputs) tokenize near 3.5 chars/token;
// 4 was an underestimate that delayed compaction and kept more context alive.
const CHARS_PER_TOKEN = 3.5

// Providers bill an image by its pixel dimensions (Anthropic: ~(w*h)/750), not
// by the length of its base64 payload. Estimating a data URL by string length
// counted a 1MB screenshot as ~285k tokens instead of ~1.6k, which pinned the
// session over the compaction threshold and burned an LLM compact call per step
// that could never bring it back under. Charge every inline image a flat cost.
const IMAGE_TOKENS = 1600
const IMAGE_PLACEHOLDER = 'i'.repeat(Math.round(IMAGE_TOKENS * CHARS_PER_TOKEN))
const IMAGE_DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/

export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

export function estimateUsage(value: unknown): number {
  return estimateTokens(JSON.stringify(value, replaceImageData) ?? '')
}

function replaceImageData(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && IMAGE_DATA_URL.test(value)) return IMAGE_PLACEHOLDER
  return value
}
