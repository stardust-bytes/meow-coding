import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CatalogProviderSummary } from '../shared/types'
import snapshot from './models-snapshot.json'

export interface CatalogProvider {
  name: string
  api?: string
  models: string[]
}

const SNAPSHOT = snapshot as unknown as Record<string, CatalogProvider>
const CATALOG_URL = 'https://models.dev/api.json'
const TTL_MS = 5 * 60_000

interface CacheEntry {
  fetchedAt: number
  providers: Record<string, CatalogProvider>
}

function mapProviders(json: Record<string, { name?: string; api?: string; models?: Record<string, unknown> }>): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {}
  for (const [id, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    providers[id] = {
      name: p.name ?? id,
      api: p.api,
      models: Object.keys(p.models ?? {})
    }
  }
  return providers
}

export class ModelsCatalog {
  constructor(
    private cacheFile: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetch(): Promise<Record<string, CatalogProvider>> {
    const cached = this.loadCache()
    if (cached) return cached
    let live: Record<string, CatalogProvider> | null = null
    try {
      const res = await this.fetchFn(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const json = (await res.json()) as Record<string, { name?: string; api?: string; models?: Record<string, unknown> }>
        live = mapProviders(json)
      }
    } catch {
      /* offline: fall back to the bundled snapshot */
    }
    const providers = live && Object.keys(live).length > 0 ? { ...SNAPSHOT, ...live } : SNAPSHOT
    this.writeCache(providers)
    return providers
  }

  async list(): Promise<CatalogProviderSummary[]> {
    const providers = await this.fetch()
    return Object.entries(providers).map(([id, p]) => ({
      id,
      name: p.name,
      api: p.api,
      modelCount: p.models.length
    }))
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
