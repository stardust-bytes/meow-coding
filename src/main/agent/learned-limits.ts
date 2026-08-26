import type { JsonStore } from '../json-store'

export interface LearnedLimitEntry {
  key: string
  context?: number
  output?: number
}

// Khóa theo endpoint thật, không phải theo id provider: cùng một model catalog
// (vd deepseek-v4-flash) có giới hạn thật khác nhau giữa ollama-cloud và một
// box tự host — học lẫn nhau giữa hai endpoint là sai.
export function normalizeLearnedKey(baseUrl: string | undefined, model: string): string {
  return `${baseUrl ?? ''}|${model}`
}

/**
 * Giới hạn khám phá được từ chính provider (qua lỗi reject), persist trong
 * userData/learned-limits.json (debounced bởi createJsonStore ở caller).
 * Chỉ bao giờ siết chặt hơn — không nâng lên: catalog có thể vẫn khai quá,
 * một giá trị wire lớn hơn chỉ tái phát lỗi 400 vừa mới học được.
 */
export class LearnedLimitsStore {
  private cache = new Map<string, LearnedLimitEntry>()

  constructor(private store: JsonStore<LearnedLimitEntry>) {
    for (const entry of store.load()) {
      if (entry && typeof entry.key === 'string') this.cache.set(entry.key, entry)
    }
  }

  get(key: string): LearnedLimitEntry | undefined {
    return this.cache.get(key)
  }

  /** Provider đã đích danh output cap thật trong một lần reject max_tokens. */
  recordMaxTokensLimit(key: string, realLimit: number): void {
    const current = this.cache.get(key)
    if (current && current.output !== undefined && current.output <= realLimit) return
    this.cache.set(key, { ...current, key, output: realLimit })
    this.persist()
  }

  /**
   * Một reject context-overflow chặn context thật ở cỡ prompt bị reject.
   * Chỉ thu hẹp trần đã lưu — giá trị lớn hơn sẽ làm compaction trễ hơn mức
   * thực tế đã fail.
   */
  recordContextOverflow(key: string, promptTokens: number): void {
    const current = this.cache.get(key)
    if (current && current.context !== undefined && current.context <= promptTokens) return
    this.cache.set(key, { ...current, key, context: promptTokens })
    this.persist()
  }

  private persist(): void {
    this.store.save([...this.cache.values()])
  }
}
