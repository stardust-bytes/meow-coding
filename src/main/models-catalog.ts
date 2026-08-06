import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CatalogProviderSummary } from '../shared/types'
import { computeVariants } from './model-variants'
import type { VariantBody } from './model-variants'
import snapshot from './models-snapshot.json'

export interface ModelLimit {
  context?: number
  output?: number
}

export interface CatalogProvider {
  name: string
  api?: string
  npm?: string
  models: string[]
  limits?: Record<string, ModelLimit>
  variants?: Record<string, Record<string, VariantBody>>
}

function modelLimits(json: Record<string, unknown> | undefined): Record<string, ModelLimit> | undefined {
  const out: Record<string, ModelLimit> = {}
  let found = false
  for (const [id, m] of Object.entries(json ?? {})) {
    if (typeof m !== 'object' || m === null) continue
    const limit = (m as { limit?: Record<string, unknown> }).limit
    if (typeof limit !== 'object' || limit === null) continue
    const context = typeof limit.context === 'number' ? limit.context : undefined
    const output = typeof limit.output === 'number' ? limit.output : undefined
    if (context !== undefined || output !== undefined) {
      out[id] = { context, output }
      found = true
    }
  }
  return found ? out : undefined
}

interface RawModel {
  reasoning?: boolean
  release_date?: string
  limit?: { context?: number; output?: number }
  reasoning_options?: unknown[]
}

interface RawProvider {
  name?: string
  api?: string
  npm?: string
  models?: Record<string, RawModel>
}

function toRawModel(m: unknown): RawModel | undefined {
  if (typeof m !== 'object' || m === null) return undefined
  const model = m as Record<string, unknown>
  return {
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
    release_date: typeof model.release_date === 'string' ? model.release_date : '',
    limit: (model.limit as { context?: number; output?: number } | undefined),
    reasoning_options: Array.isArray(model.reasoning_options) ? model.reasoning_options : undefined
  }
}

function toRawProvider(p: unknown): RawProvider | undefined {
  if (typeof p !== 'object' || p === null) return undefined
  const prov = p as Record<string, unknown>
  const models = prov.models as Record<string, unknown> | undefined
  return {
    name: typeof prov.name === 'string' ? prov.name : undefined,
    api: typeof prov.api === 'string' ? prov.api : undefined,
    npm: typeof prov.npm === 'string' ? prov.npm : undefined,
    models: models && typeof models === 'object'
      ? Object.fromEntries(
          Object.entries(models).flatMap(([id, m]) => {
            const raw = toRawModel(m)
            return raw ? [[id, raw] as const] : []
          })
        )
      : undefined
  }
}

const SNAPSHOT = snapshot as unknown as Record<string, unknown>
const CATALOG_URL = 'https://models.dev/api.json'
const TTL_MS = 5 * 60_000

interface CacheEntry {
  fetchedAt: number
  providers: Record<string, CatalogProvider>
}

function mapProviders(json: Record<string, unknown>): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {}
  for (const [id, rawP] of Object.entries(json)) {
    const p = toRawProvider(rawP)
    if (!p) continue
    const variants: Record<string, Record<string, VariantBody>> = {}
    for (const [modelId, m] of Object.entries(p.models ?? {})) {
      const info = {
        id: modelId,
        providerId: id,
        npm: p.npm ?? '@ai-sdk/openai-compatible',
        reasoning: m.reasoning ?? false,
        releaseDate: m.release_date ?? '',
        limitOutput: m.limit?.output,
        reasoningOptions: (m.reasoning_options ?? []) as Array<{ type: string; values?: unknown[]; min?: number; max?: number }>
      }
      const desc = computeVariants(info)
      if (desc && Object.keys(desc).length > 0) variants[modelId] = desc
    }
    providers[id] = {
      name: p.name ?? id,
      api: p.api,
      npm: p.npm,
      models: Object.keys(p.models ?? {}),
      limits: modelLimits(p.models as Record<string, unknown>),
      ...(Object.keys(variants).length > 0 ? { variants } : {})
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
    let live: Record<string, unknown> | null = null
    try {
      const res = await this.fetchFn(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        live = (await res.json()) as Record<string, unknown>
      }
    } catch {
      /* offline: fall back to the bundled snapshot */
    }
    const raw = live && Object.keys(live).length > 0 ? { ...SNAPSHOT, ...live } : SNAPSHOT
    const providers = mapProviders(raw)
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

  async getModelLimit(providerId: string, modelId: string): Promise<ModelLimit | undefined> {
    const providers = await this.fetch()
    return providers[providerId]?.limits?.[modelId]
  }

  async getVariants(providerId: string, modelId: string): Promise<string[]> {
    const providers = await this.fetch()
    return Object.keys(providers[providerId]?.variants?.[modelId] ?? {})
  }

  async getVariantOptions(providerId: string, modelId: string, variantId: string): Promise<VariantBody | undefined> {
    const providers = await this.fetch()
    return providers[providerId]?.variants?.[modelId]?.[variantId]
  }

  private loadCache(): Record<string, CatalogProvider> | null {
    if (!existsSync(this.cacheFile)) return null
    try {
      const entry = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as CacheEntry
      const isOldShape = Object.values(entry?.providers ?? {}).some(p => {
        const v = (p as CatalogProvider).variants
        return v && Object.values(v).some(val => Array.isArray(val))
      })
      if (entry?.providers && !isOldShape && Date.now() - entry.fetchedAt < TTL_MS) {
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
