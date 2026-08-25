import { describe, expect, it } from 'vitest'
import { describe, expect, it } from 'vitest'
import { codexVariantOptions, parseCodexModelCatalog } from '../../src/main/connections/codex-model-catalog'

describe('parseCodexModelCatalog', () => {
  it('normalizes provider models and preserves provider-declared effort values and order', () => {
    expect(parseCodexModelCatalog({
      data: [
        { id: ' gpt-5.6 ', name: ' GPT-5.6 ', variants: ['low', ' max ', 'ultra'] }
      ]
    })).toEqual([
      { model: 'gpt-5.6', label: 'GPT-5.6', variants: ['low', 'max', 'ultra'] }
    ])
  })

  it('omits entries without a nonempty string ID and falls back blank labels to the model ID', () => {
    expect(parseCodexModelCatalog({
      data: [
        { id: ' ', name: 'ignored', variants: ['high'] },
        { id: 42, name: 'ignored', variants: ['high'] },
        { id: 'gpt-5.6', name: ' ', variants: [] }
      ]
    })).toEqual([
      { model: 'gpt-5.6', label: 'gpt-5.6', variants: [] }
    ])
  })

  it('treats malformed or missing variants as empty and trims duplicates without fallback efforts', () => {
    expect(parseCodexModelCatalog({
      data: [
        { id: 'missing', name: 'Missing' },
        { id: 'malformed', name: 'Malformed', variants: 'high' },
        { id: 'deduped', name: 42, variants: [' high ', '', 12, 'high', 'ultra', ' ultra '] }
      ]
    })).toEqual([
      { model: 'missing', label: 'Missing', variants: [] },
      { model: 'malformed', label: 'Malformed', variants: [] },
      { model: 'deduped', label: 'deduped', variants: ['high', 'ultra'] }
    ])
  })

  it('rejects malformed response shapes', () => {
    expect(parseCodexModelCatalog(undefined)).toEqual([])
    expect(parseCodexModelCatalog({ data: {} })).toEqual([])
    expect(parseCodexModelCatalog({ models: [] })).toEqual([])
  })
})

describe('codexVariantOptions', () => {
  it('creates an OpenAI-compatible descriptor only for a declared selected effort', () => {
    expect(codexVariantOptions(['low', 'high', 'ultra'], 'ultra')).toEqual({
      openaiCompatible: { reasoningEffort: 'ultra' }
    })
  })

  it('does not create descriptors for absent or stale variants', () => {
    expect(codexVariantOptions(['high'], undefined)).toBeUndefined()
    expect(codexVariantOptions(['high'], 'ultra')).toBeUndefined()
  })
})
