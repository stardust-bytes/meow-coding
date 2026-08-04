import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface CatalogProvider {
  name: string
  models: string[]
}

const CATALOG_URL = 'https://models.dev/api.json'
const TTL_MS = 5 * 60_000

interface CacheEntry {
  fetchedAt: number
  providers: Record<string, CatalogProvider>
}

export class ModelsCatalog {
  constructor(
    private cacheFile: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetch(): Promise<Record<string, CatalogProvider>> {
    const cached = this.loadCache()
    if (cached) return cached
    try {
      const res = await this.fetchFn(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return {}
      const json = (await res.json()) as Record<string, { name?: string; models?: Record<string, unknown> }>
      const providers: Record<string, CatalogProvider> = {}
      for (const [id, p] of Object.entries(json)) {
        if (typeof p !== 'object' || p === null) continue
        providers[id] = {
          name: p.name ?? id,
          models: Object.keys(p.models ?? {})
        }
      }
      this.writeCache(providers)
      return providers
    } catch {
      return {}
    }
  }

  private loadCache(): Record<string, CatalogProvider> | null {
    if (!existsSync(this.cacheFile)) return null
    try {
      const entry = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as CacheEntry
      if (entry?.providers && Date.now() - entry.fetchedAt < TTL_MS) {
        return entry.providers
      }
    } catch {
      /* corrupt cache is ignored */
    }
    return null
  }

  private writeCache(providers: Record<string, CatalogProvider>): void {
    try {
      mkdirSync(path.dirname(this.cacheFile), { recursive: true })
      const entry: CacheEntry = { fetchedAt: Date.now(), providers }
      writeFileSync(this.cacheFile, JSON.stringify(entry))
    } catch {
      /* non-fatal */
    }
  }
}
