import { randomUUID } from 'node:crypto'
import type { ApiKeyInput, ProviderAccount } from '../../../shared/types'
import type { AdapterContext, ProviderAdapter } from '../manager'
import type { ConnectionSecrets } from '../types'

function defaultApiKeyField(baseUrl?: string): string {
  if (!baseUrl) return 'ANTHROPIC_API_KEY'
  return /anthropic/i.test(baseUrl) ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
}

// Encrypted API-key vault for native providers (Anthropic, OpenAI-compatible,
// relay). Secrets live in the Vault; the account JSON holds metadata only.
export const apiKeyAdapter: ProviderAdapter = {
  provider: 'apikey',

  async importFromJson(json: string, ctx: AdapterContext): Promise<ProviderAccount> {
    const input: ApiKeyInput = JSON.parse(json)
    if (!input.apiKey?.trim()) throw new Error('[meow] Thiếu API key')
    const id = randomUUID()
    const baseUrl = input.apiBaseUrl?.trim() || undefined
    const field = input.apiKeyField?.trim() || defaultApiKeyField(baseUrl)
    ctx.store.setApiKey(id, input.apiKey.trim())
    return {
      id,
      provider: 'apikey',
      name: input.label.trim() || `${field} ${id.slice(0, 4)}`,
      authMode: 'api-key',
      active: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      apiBaseUrl: baseUrl,
      apiKeyField: field,
      extraEnv: input.extraEnv,
      note: input.note
    }
  },

  async test(account: ProviderAccount, secrets: ConnectionSecrets): Promise<{ ok: boolean; error?: string }> {
    const apiKey = secrets.apiKey
    if (!apiKey) return { ok: false, error: 'Thiếu API key trong vault' }
    const field = account.apiKeyField ?? 'ANTHROPIC_API_KEY'
    const baseUrl = (account.apiBaseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        if (field === 'ANTHROPIC_API_KEY' || field === 'ANTHROPIC_AUTH_TOKEN') {
          const res = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              'anthropic-version': '2023-06-01',
              ...(field === 'ANTHROPIC_API_KEY'
                ? { 'x-api-key': apiKey }
                : { authorization: `Bearer ${apiKey}` })
            },
            body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` }
          }
          return { ok: true }
        }
        const url = `${baseUrl}/v1/models`
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}` }
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` }
        }
        return { ok: true }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
}
