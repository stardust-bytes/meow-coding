import type { VariantDescriptor } from '../model-variants'

export interface CodexModelCatalogModel {
  model: string
  label: string
  variants: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseVariants(rawVariants: unknown): string[] {
  if (!Array.isArray(rawVariants)) return []

  const variants: string[] = []
  const seen = new Set<string>()
  for (const rawVariant of rawVariants) {
    if (typeof rawVariant !== 'string') continue
    const variant = rawVariant.trim()
    if (!variant || seen.has(variant)) continue
    seen.add(variant)
    variants.push(variant)
  }
  return variants
}

/** Parses the minimal, non-secret catalog written by the Codex proxy sidecar. */
export function parseCodexModelCatalog(json: unknown): CodexModelCatalogModel[] {
  if (!isRecord(json) || !Array.isArray(json.data)) return []

  const models: CodexModelCatalogModel[] = []
  for (const item of json.data) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const model = item.id.trim()
    if (!model) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    models.push({
      model,
      label: name || model,
      variants: parseVariants(item.variants)
    })
  }
  return models
}

export function codexVariantOptions(
  variants: readonly string[],
  selected: string | undefined
): VariantDescriptor | undefined {
  if (selected === undefined || !variants.includes(selected)) return undefined
  return { openaiCompatible: { reasoningEffort: selected } }
}
