import { describe, expect, it } from 'vitest'
import { computeVariants } from '../../src/main/model-variants'
import type { ModelVariantInfo } from '../../src/main/model-variants'

function info(partial: Partial<ModelVariantInfo> & { id: string }): ModelVariantInfo {
  return {
    providerId: 'x',
    npm: '@ai-sdk/openai-compatible',
    reasoning: true,
    releaseDate: '2026-01-01',
    reasoningOptions: [],
    ...partial
  }
}

describe('computeVariants (port of opencode variants())', () => {
  it('minimax-m3 with anthropic npm → none/thinking', () => {
    const v = computeVariants(info({
      id: 'MiniMax-M3',
      providerId: 'minimax',
      npm: '@ai-sdk/anthropic',
      reasoningOptions: [{ type: 'toggle' }]
    }))
    expect(v).toEqual({
      none: { openaiCompatible: { thinking: { type: 'disabled' } } },
      thinking: { openaiCompatible: { thinking: { type: 'adaptive' } } }
    })
  })

  it('deepseek-v4-flash openai-compatible → effort values verbatim', () => {
    const v = computeVariants(info({
      id: 'deepseek-v4-flash',
      providerId: 'deepseek',
      npm: '@ai-sdk/openai-compatible',
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }]
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'high', 'max'])
  })

  it('deepseek-v4-flash with EMPTY reasoning_options → variants() adds medium', () => {
    const v = computeVariants(info({
      id: 'deepseek-v4-flash',
      providerId: 'deepseek',
      npm: '@ai-sdk/openai-compatible',
      reasoningOptions: undefined
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'medium', 'high', 'max'])
    expect(v?.high).toEqual({ openaiCompatible: { reasoningEffort: 'high' } })
  })

  it('deepseek-chat reasoning:false → no variants', () => {
    const v = computeVariants(info({
      id: 'deepseek-chat',
      providerId: 'deepseek',
      reasoning: false,
      reasoningOptions: undefined
    }))
    expect(v).toBeUndefined()
  })

  it('openai gpt-5 with absent options → release-date based efforts', () => {
    const v = computeVariants(info({
      id: 'gpt-5.4',
      providerId: 'openai',
      npm: '@ai-sdk/openai',
      releaseDate: '2026-03-01',
      reasoningOptions: undefined
    }))
    const keys = Object.keys(v ?? {})
    expect(keys).toContain('medium')
    expect(keys).toContain('high')
    expect(keys).toContain('xhigh')
    expect(v?.high).toEqual({
      openaiCompatible: { reasoningEffort: 'high', reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] }
    })
  })

  it('anthropic claude-opus-4.6 adaptive → low..max', () => {
    const v = computeVariants(info({
      id: 'claude-opus-4.6',
      providerId: 'anthropic',
      npm: '@ai-sdk/anthropic',
      reasoningOptions: undefined
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'medium', 'high', 'max'])
    expect(v?.high).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'high' }
    })
  })

  it('google gemini-2.5-pro → high/max with thinkingBudget', () => {
    const v = computeVariants(info({
      id: 'gemini-2.5-pro',
      providerId: 'google',
      npm: '@ai-sdk/google',
      limitOutput: 65536,
      reasoningOptions: undefined
    }))
    expect(Object.keys(v ?? {})).toEqual(['high', 'max'])
    expect(v?.high).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } }
    })
  })

  it('grok-3-mini → low/high', () => {
    const v = computeVariants(info({
      id: 'grok-3-mini',
      providerId: 'xai',
      npm: '@ai-sdk/xai',
      reasoningOptions: undefined
    }))
    expect(Object.keys(v ?? {})).toEqual(['low', 'high'])
  })

  it('minimax non-M3 (toggle only) → {}', () => {
    const v = computeVariants(info({
      id: 'MiniMax-M2',
      providerId: 'minimax',
      npm: '@ai-sdk/anthropic',
      reasoningOptions: [{ type: 'toggle' }]
    }))
    expect(v).toEqual({})
  })
})
