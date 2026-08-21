import type { ProviderAccount } from '../../shared/types'
import type { ConnectionSecrets } from '../connections/types'

// Default upstreams for OpenAI-compatible accounts routed by the gateway.
function upstreamFor(account: ProviderAccount): string {
  if (account.apiBaseUrl) return account.apiBaseUrl.replace(/\/+$/, '')
  if (account.codexAuthMode === 'apikey') return 'https://api.openai.com/v1'
  // Codex OAuth uses the ChatGPT backend proxy (same wire protocol).
  return 'https://chatgpt.com/backend-api/codex/v1'
}

function bearerFor(secrets: ConnectionSecrets): string | null {
  if (secrets.apiKey) return secrets.apiKey
  if (secrets.tokens?.accessToken) return secrets.tokens.accessToken
  return null
}

export interface ForwardResult {
  status: number
  headers: Record<string, string>
  /** Body as Buffer for non-stream, or the upstream response to relay for SSE. */
  body?: Buffer
  stream?: ReadableStream<Uint8Array>
  tokensIn: number
  tokensOut: number
  error?: string
}

// Forward a chat-completions request to the selected account's upstream.
// Body is passed through unchanged (stream/tools/max_tokens...) — only the
// Authorization header is replaced with the account's credential.
export async function forwardChatCompletions(
  account: ProviderAccount,
  secrets: ConnectionSecrets,
  body: string,
  signal?: AbortSignal
): Promise<ForwardResult> {
  const token = bearerFor(secrets)
  if (!token) return { status: 503, headers: {}, tokensIn: 0, tokensOut: 0, error: '[meow] Account thiếu token' }

  const url = `${upstreamFor(account)}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body
  })

  const tokensIn = 0
  const tokensOut = 0

  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    return {
      status: res.status,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      },
      stream: res.body ?? undefined,
      tokensIn,
      tokensOut,
      ...(res.status >= 400 ? { error: `HTTP ${res.status}` } : {})
    }
  }

  const buf = Buffer.from(await res.arrayBuffer())
  // Try to extract token usage from a JSON body for logging.
  let usageTokensIn = 0
  let usageTokensOut = 0
  try {
    const parsed = JSON.parse(buf.toString('utf-8')) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    usageTokensIn = parsed.usage?.prompt_tokens ?? 0
    usageTokensOut = parsed.usage?.completion_tokens ?? 0
  } catch {
    // Not JSON — ignore usage.
  }

  return {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    body: buf,
    tokensIn: usageTokensIn,
    tokensOut: usageTokensOut,
    ...(res.status >= 400 ? { error: `HTTP ${res.status} ${buf.toString('utf-8').slice(0, 200)}` } : {})
  }
}

export async function forwardListModels(
  accounts: Array<{ account: ProviderAccount; secrets: ConnectionSecrets }>
): Promise<{ status: number; body: Buffer }> {
  const models = new Set<string>()
  // Probe upstream /v1/models (best-effort, short timeout).
  await Promise.all(accounts.map(async ({ account, secrets }) => {
    const token = bearerFor(secrets)
    if (!token) return
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${upstreamFor(account)}/models`, {
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}` }
      })
      clearTimeout(timer)
      if (!res.ok) return
      const parsed = await res.json() as { data?: Array<{ id?: string }> }
      for (const m of parsed.data ?? []) if (m.id) models.add(m.id)
    } catch {
      // Ignore unreachable upstreams.
    }
  }))
  if (models.size === 0) {
    models.add('gpt-4o-mini')
    models.add('gpt-4o')
  }
  return {
    status: 200,
    body: Buffer.from(JSON.stringify({ object: 'list', data: [...models].map(id => ({ id, object: 'model', owned_by: 'meow-gateway' })) }))
  }
}
