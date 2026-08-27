import type { LiveModelInfo } from '../models-catalog'
import { LearnedLimitsStore, normalizeLearnedKey } from './learned-limits'
import { DEFAULT_MAX_CONTEXT_TOKENS, MAX_OUTPUT_HARD_CAP } from './config'

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
  'please reduce the length of the messages',
  // Các proxy OpenAI-compatible (vd "deepseek 30 day") reject input quá trần
  // bằng "Input token exceed the limit (request id: ...)".
  'input token exceed',
  'exceed the limit'
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

export interface ResolvedLimits {
  context: number
  output: number | null
}

export interface LimitsServiceDeps {
  learned: LearnedLimitsStore
  getCatalogLimit?: (providerId: string, modelId: string) => Promise<{ context?: number; output?: number } | undefined>
  fetchLiveModels?: (baseUrl: string, apiKey: string) => Promise<LiveModelInfo[] | null>
  now?: () => number
}

export const LIVE_MODELS_TTL_MS = 5 * 60_000

interface LiveCacheEntry {
  fetchedAt: number
  info: LiveModelInfo[] | null
}

/**
 * Phân giải giới hạn thật của model từ nguồn đáng tin cậy nhất có biết về nó.
 * "Trust the provider, verify by error": mỗi tầng là một phỏng đoán cho tới khi
 * provider tự xác nhận. output = null khi không nguồn nào đáng tin khai cap —
 * wire lúc đó bỏ hẳn max_tokens, đó chính là thứ làm lỗi `max_tokens exceeds`
 * không thể xảy ra.
 */
export class LimitsService {
  private liveCache = new Map<string, LiveCacheEntry>()
  private livePending = new Set<string>()

  constructor(private deps: LimitsServiceDeps) {}

  async resolveLimits(args: {
    provider: string
    model: string
    baseUrl?: string
    apiKey?: string
    overrides?: { context?: number; output?: number }
  }): Promise<ResolvedLimits> {
    const overrides = args.overrides
    if (overrides && (overrides.context !== undefined || overrides.output !== undefined)) {
      return { context: overrides.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: overrides.output ?? null }
    }
    const learned = this.deps.learned.get(normalizeLearnedKey(args.baseUrl, args.model))
    if (learned && (learned.context !== undefined || learned.output !== undefined)) {
      return { context: learned.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: learned.output ?? null }
    }
    const live = this.liveInfo(args.baseUrl, args.apiKey)
    const liveModel = live?.find(m => matchModel(m.id, args.model))
    if (liveModel && (liveModel.context !== undefined || liveModel.output !== undefined)) {
      return { context: liveModel.context ?? DEFAULT_MAX_CONTEXT_TOKENS, output: liveModel.output ?? null }
    }
    const catalogLimit = await this.deps.getCatalogLimit?.(args.provider, args.model)
    if (catalogLimit && (catalogLimit.context !== undefined || catalogLimit.output !== undefined)) {
      return {
        context: catalogLimit.context ?? DEFAULT_MAX_CONTEXT_TOKENS,
        // Catalog là nguồn duy nhất có thể khai quá mức trắng trợn (claim 1M
        // trên endpoint thật chỉ 64k), nên output của nó bị cap.
        output: catalogLimit.output === undefined ? null : Math.min(catalogLimit.output, MAX_OUTPUT_HARD_CAP)
      }
    }
    return { context: DEFAULT_MAX_CONTEXT_TOKENS, output: null }
  }

  // Synchronous: không bao giờ chặn caller lên mạng. Cache miss → kick fetch
  // nền (dedupe bằng livePending); resolve hiện tại trả về cái đang biết, fetch
  // lấp cache cho resolve kế tiếp.
  private liveInfo(baseUrl: string | undefined, apiKey: string | undefined): LiveModelInfo[] | null {
    if (!baseUrl || !apiKey || !this.deps.fetchLiveModels) return null
    const cacheKey = `${baseUrl}|${apiKey}`
    const now = this.deps.now?.() ?? Date.now()
    const cached = this.liveCache.get(cacheKey)
    if (cached && now - cached.fetchedAt < LIVE_MODELS_TTL_MS) return cached.info
    if (this.livePending.has(cacheKey)) return cached?.info ?? null
    this.livePending.add(cacheKey)
    const finish = (info: LiveModelInfo[] | null): void => {
      this.livePending.delete(cacheKey)
      this.liveCache.set(cacheKey, { fetchedAt: now, info })
    }
    Promise.resolve(this.deps.fetchLiveModels(baseUrl, apiKey)).then(finish, () => finish(null))
    return cached?.info ?? null
  }
}
