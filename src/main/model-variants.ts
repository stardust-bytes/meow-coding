export interface ReasoningOption {
  type: string
  values?: unknown[]
  min?: number
  max?: number
}

export interface ModelVariantInfo {
  id: string
  providerId: string
  npm: string
  reasoning: boolean
  releaseDate: string
  limitOutput?: number
  reasoningOptions?: ReasoningOption[]
}

export type VariantBody = Record<string, unknown>
export type VariantDescriptor = Record<string, VariantBody>

const WIDELY_SUPPORTED_EFFORTS = ['low', 'medium', 'high']
const OPENAI_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const OPENAI_GPT5_1_EFFORTS = ['none', 'low', 'medium', 'high']
const OPENAI_GPT5_2_PLUS_EFFORTS = [...OPENAI_GPT5_1_EFFORTS, 'xhigh']
const OPENAI_GPT5_PRO_EFFORTS = ['high']
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS = ['medium', 'high', 'xhigh']
const OPENAI_GPT5_CHAT_EFFORTS = ['medium']
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, 'xhigh']
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS = ['none', ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS]
const OPENAI_NONE_EFFORT_RELEASE_DATE = '2025-11-13'
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = '2025-12-04'
const INCLUDE_ENCRYPTED_REASONING = ['reasoning.encrypted_content']

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/

function gpt5Version(apiId: string): number | undefined {
  return Number(GPT5_VERSION_RE.exec(apiId)?.[1]) || undefined
}

function versionedGpt5ReasoningEfforts(apiId: string): string[] | undefined {
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS
  const version = gpt5Version(apiId)
  if (version === undefined) return undefined
  if (version === 1) return OPENAI_GPT5_1_EFFORTS
  return OPENAI_GPT5_2_PLUS_EFFORTS
}

function gpt5CodexReasoningEfforts(apiId: string): string[] | undefined {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes('codex')) return undefined
  const version = gpt5Version(apiId)
  if (version !== undefined && version >= 3) return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS
  if (apiId.includes('codex-max') || (version !== undefined && version >= 2)) return OPENAI_GPT5_CODEX_XHIGH_EFFORTS
  return WIDELY_SUPPORTED_EFFORTS
}

function gpt5ChatReasoningEfforts(apiId: string): string[] | undefined {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes('-chat')) return undefined
  return gpt5Version(apiId) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS
}

function openaiReasoningEfforts(apiId: string, releaseDate: string): string[] {
  const id = apiId.toLowerCase()
  if (id.includes('deep-research')) return ['medium']
  const chatEfforts = gpt5ChatReasoningEfforts(id)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(id)) return OPENAI_GPT5_PRO_EFFORTS
  const codexEfforts = gpt5CodexReasoningEfforts(id)
  if (codexEfforts) return codexEfforts
  const versionedEfforts = versionedGpt5ReasoningEfforts(id)
  if (versionedEfforts) return versionedEfforts
  const efforts = [...WIDELY_SUPPORTED_EFFORTS]
  if (GPT5_FAMILY_RE.test(id)) efforts.unshift('minimal')
  if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift('none')
  if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push('xhigh')
  return efforts
}

function openaiCompatibleReasoningEfforts(id: string): string[] {
  const apiId = id.toLowerCase()
  const chatEfforts = gpt5ChatReasoningEfforts(apiId)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_EFFORTS
  return gpt5CodexReasoningEfforts(apiId) ?? versionedGpt5ReasoningEfforts(apiId) ?? OPENAI_EFFORTS
}

function anthropicUsesModernAdaptiveThinking(apiId: string): boolean {
  if (!apiId.toLowerCase().includes('claude-')) return false
  const version = /claude-(?:[a-z]+-)?(\d+)(?:[.-](\d{1,2}))?(?:[.@-]|$)/i.exec(apiId)
  if (!version) return true
  const major = Number(version[1])
  const minor = Number(version[2] ?? 0)
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicAdaptiveEfforts(apiId: string): string[] | null {
  if (anthropicUsesModernAdaptiveThinking(apiId)) {
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (
    ['opus-4-6', 'opus-4.6', '4-6-opus', '4.6-opus', 'sonnet-4-6', 'sonnet-4.6', '4-6-sonnet', '4.6-sonnet'].some(v =>
      apiId.includes(v)
    )
  ) {
    return ['low', 'medium', 'high', 'max']
  }
  return null
}

function anthropicOmitsThinking(apiId: string): boolean {
  return anthropicUsesModernAdaptiveThinking(apiId)
}

function anthropicOpus45(apiId: string): boolean {
  return ['opus-4-5', 'opus-4.5'].some(v => apiId.includes(v))
}

function anthropicOpus45Effort(info: ModelVariantInfo, effort: string): VariantBody {
  return {
    thinking: {
      type: 'enabled',
      budgetTokens: Math.min(16_000, Math.floor((info.limitOutput ?? 32000) / 2 - 1))
    },
    effort
  }
}

function isKimiFamily(info: ModelVariantInfo): boolean {
  if ([info.providerId, info.id].some(id => {
    const value = id.toLowerCase()
    return value.includes('kimi') || value.includes('moonshot')
  })) return true
  return false
}

function googleThinkingLevelEfforts(apiId: string): string[] {
  const id = apiId.toLowerCase()
  if (!id.includes('gemini-3')) return ['low', 'high']
  if (id.includes('flash-image')) return ['minimal', 'high']
  if (id.includes('pro-image')) return ['high']
  if (id.includes('flash')) return ['minimal', 'low', 'medium', 'high']
  return ['low', 'medium', 'high']
}

function googleThinkingBudgetMax(apiId: string): number {
  const id = apiId.toLowerCase()
  if (id.includes('2.5') && id.includes('pro') && !id.includes('flash')) return 32_768
  return 24_576
}

function sdkKeyForProvider(providerId: string): string {
  if (providerId === 'anthropic') return 'anthropic'
  if (providerId === 'google') return 'google'
  return 'openaiCompatible'
}

function wrap(providerId: string, body: VariantBody): VariantBody {
  const key = sdkKeyForProvider(providerId)
  if (key === 'openaiCompatible') return { openaiCompatible: body }
  return { [key]: body }
}

function googleThinkingVariants(info: ModelVariantInfo): VariantDescriptor {
  const id = info.id.toLowerCase()
  const wrapBody = (body: VariantBody) => wrap(info.providerId, body)
  if (id.includes('2.5')) {
    return {
      high: wrapBody({ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } }),
      max: wrapBody({ thinkingConfig: { includeThoughts: true, thinkingBudget: googleThinkingBudgetMax(id) } })
    }
  }
  return Object.fromEntries(
    googleThinkingLevelEfforts(id).map(effort => [
      effort,
      wrapBody({ thinkingConfig: { includeThoughts: true, thinkingLevel: effort } })
    ])
  )
}

function reasoningEffortBody(info: ModelVariantInfo, effort: string): VariantBody | undefined {
  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return { reasoning: { effort } }
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return anthropicEffortBody(info, effort) ?? { effort }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
    case '@ai-sdk/openai':
    case '@ai-sdk/azure':
      return { reasoningEffort: effort, reasoningSummary: 'auto', include: [...INCLUDE_ENCRYPTED_REASONING] }
    default:
      return { reasoningEffort: effort }
  }
}

function anthropicEffortBody(info: ModelVariantInfo, effort: string): VariantBody | undefined {
  if (anthropicOpus45(info.id)) return anthropicOpus45Effort(info, effort)
  if (isKimiFamily(info)) return { thinking: { type: 'adaptive', display: 'summarized' }, effort }
  if (!anthropicAdaptiveEfforts(info.id)) return undefined
  return {
    thinking: {
      type: 'adaptive',
      ...(anthropicOmitsThinking(info.id) ? { display: 'summarized' } : {})
    },
    effort
  }
}

function reasoningToggleBody(info: ModelVariantInfo): VariantDescriptor {
  if (info.providerId === 'minimax' && info.id.toLowerCase().includes('minimax-m3')) {
    return {
      none: wrap(info.providerId, { thinking: { type: 'disabled' } }),
      thinking: wrap(info.providerId, { thinking: { type: 'adaptive' } })
    }
  }
  return {}
}

function reasoningBudgetBody(info: ModelVariantInfo, budget: number): VariantBody | undefined {
  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return { reasoning: { max_tokens: budget } }
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return { thinking: { type: 'enabled', budgetTokens: budget } }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
    default:
      return undefined
  }
}

function reasoningVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  const opts = info.reasoningOptions
  if (opts === undefined) return undefined
  if (opts.length === 0) return {}
  const effort = opts.find(o => o.type === 'effort')
  if (effort) {
    const out: VariantDescriptor = {}
    for (const value of effort.values ?? []) {
      const id = value === null ? 'none' : typeof value === 'string' ? value : undefined
      if (id === undefined) continue
      const body = reasoningEffortBody(info, id)
      if (body) out[id] = wrap(info.providerId, body)
    }
    return out
  }
  const toggle = opts.some(o => o.type === 'toggle')
  const budget = opts.find(o => o.type === 'budget_tokens')
  if (!budget) {
    if (!toggle) return undefined
    const t = reasoningToggleBody(info)
    return Object.keys(t).length > 0 ? t : {}
  }
  const out: VariantDescriptor = {}
  if (toggle) Object.assign(out, reasoningToggleBody(info))
  const maxBudget = Math.min(budget.max ?? 31999, (info.limitOutput ?? 32000) - 1, 31999)
  if (maxBudget > 0) {
    const high = Math.min(Math.max(budget.min ?? 0, Math.floor((maxBudget + 1) / 2)), maxBudget)
    for (const [id, b] of [
      ['high', reasoningBudgetBody(info, high)],
      ['max', reasoningBudgetBody(info, maxBudget)]
    ] as const) {
      if (b) out[id] = wrap(info.providerId, b)
    }
  }
  return Object.keys(out).length > 0 ? out : {}
}

function hardcodedVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  if (!info.reasoning) return undefined
  const id = info.id.toLowerCase()
  const glm52 = ['glm-5.2', 'glm-5-2', 'glm-5p2'].some(name => id.includes(name))
  if (id.includes('minimax-m3')) {
    return reasoningToggleBody(info)
  }
  const adaptiveEfforts = anthropicAdaptiveEfforts(info.id)
  if (glm52 && info.npm === '@openrouter/ai-sdk-provider') {
    return Object.fromEntries(['high', 'xhigh'].map(effort => [effort, wrap(info.providerId, { reasoning: { effort } })]))
  }
  if (glm52 && info.npm === '@ai-sdk/openai-compatible') {
    return Object.fromEntries(['high', 'max'].map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })]))
  }
  if (glm52 && info.npm === '@ai-sdk/anthropic') {
    return Object.fromEntries(['high', 'max'].map(effort => [effort, wrap(info.providerId, { effort })]))
  }
  if (isKimiFamily(info) && ['@ai-sdk/anthropic', '@ai-sdk/google-vertex/anthropic'].includes(info.npm)) {
    return Object.fromEntries(
      ['low', 'medium', 'high', 'xhigh', 'max'].map(effort => [
        effort,
        wrap(info.providerId, { thinking: { type: 'adaptive', display: 'summarized' }, effort })
      ])
    )
  }
  if (
    id.includes('deepseek-chat') || id.includes('deepseek-reasoner') || id.includes('deepseek-r1') ||
    id.includes('deepseek-v3') || id.includes('minimax') || (id.includes('glm') && !glm52) ||
    id.includes('kimi') || id.includes('k2p') || id.includes('qwen') || id.includes('big-pickle')
  ) return {}
  if (id.includes('grok') && id.includes('grok-3-mini')) {
    const body = (e: string) => info.npm === '@openrouter/ai-sdk-provider' ? { reasoning: { effort: e } } : { reasoningEffort: e }
    return Object.fromEntries(['low', 'high'].map(e => [e, wrap(info.providerId, body(e))]))
  }

  switch (info.npm) {
    case '@openrouter/ai-sdk-provider':
      return Object.fromEntries(
        (id.startsWith('openai/') || id.includes('gpt')
          ? openaiCompatibleReasoningEfforts(info.id)
          : WIDELY_SUPPORTED_EFFORTS
        ).map(effort => [effort, wrap(info.providerId, { reasoning: { effort } })])
      )
    case '@ai-sdk/azure':
    case '@ai-sdk/openai':
      return Object.fromEntries(
        openaiReasoningEfforts(info.id, info.releaseDate).map(effort => [
          effort,
          wrap(info.providerId, {
            reasoningEffort: effort,
            reasoningSummary: 'auto',
            include: [...INCLUDE_ENCRYPTED_REASONING]
          })
        ])
      )
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      if (adaptiveEfforts) {
        return Object.fromEntries(
          adaptiveEfforts.map(effort => [
            effort,
            wrap(info.providerId, {
              thinking: { type: 'adaptive', ...(anthropicOmitsThinking(info.id) ? { display: 'summarized' } : {}) },
              effort
            })
          ])
        )
      }
      if (anthropicOpus45(info.id)) {
        return Object.fromEntries(
          WIDELY_SUPPORTED_EFFORTS.map(effort => [effort, wrap(info.providerId, anthropicOpus45Effort(info, effort))])
        )
      }
      return {
        high: wrap(info.providerId, { thinking: { type: 'enabled', budgetTokens: Math.min(16_000, Math.floor((info.limitOutput ?? 32000) / 2 - 1)) } }),
        max: wrap(info.providerId, { thinking: { type: 'enabled', budgetTokens: Math.min(31_999, (info.limitOutput ?? 32000) - 1) } })
      }
    case '@ai-sdk/google':
    case '@ai-sdk/google-vertex':
      return googleThinkingVariants(info)
    case '@ai-sdk/mistral': {
      const MISTRAL_REASONING_IDS = ['mistral-small-2603', 'mistral-small-latest', 'mistral-medium-3.5', 'mistral-medium-2604']
      const mistralId = info.id.toLowerCase()
      if (!MISTRAL_REASONING_IDS.some(m => mistralId.includes(m))) return {}
      return { high: wrap(info.providerId, { reasoningEffort: 'high' }) }
    }
    case '@ai-sdk/cohere':
    case '@ai-sdk/perplexity':
      return {}
    case '@ai-sdk/groq':
      return Object.fromEntries(
        ['none', ...WIDELY_SUPPORTED_EFFORTS].map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })])
      )
    case '@ai-sdk/cerebras':
    case '@ai-sdk/togetherai':
    case '@ai-sdk/xai':
    case '@ai-sdk/deepinfra':
    case '@ai-sdk/openai-compatible': {
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (id.includes('deepseek-v4')) efforts.push('max')
      return Object.fromEntries(efforts.map(effort => [effort, wrap(info.providerId, { reasoningEffort: effort })]))
    }
    default:
      return {}
  }
}

export function computeVariants(info: ModelVariantInfo): VariantDescriptor | undefined {
  return reasoningVariants(info) ?? hardcodedVariants(info)
}
