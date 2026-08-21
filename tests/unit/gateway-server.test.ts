import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startGatewayServer, type GatewayServerHandle } from '../../src/main/gateway/server'
import { GatewayLogStore } from '../../src/main/gateway/log-store'
import type { AccountHealth } from '../../src/main/gateway/router'
import type { GatewayConfig, ProviderAccount } from '../../src/shared/types'
import type { ConnectionSecrets } from '../../src/main/connections/types'

const fetchMock = vi.fn()
const realFetch = globalThis.fetch

// Only the gateway's OUTBOUND upstream calls are mocked; client requests to
// 127.0.0.1 still hit the real local server.
function mockUpstream(): typeof fetchMock {
  vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('http://127.0.0.1')) return realFetch(input, init)
    return fetchMock(input, init)
  }) as typeof fetch)
  return fetchMock
}

function makeCfg(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    enabled: true, port: 0, apiKey: 'gw-key', routingStrategy: 'auto',
    coldownSeconds: 300, quotaReservePercent: 10, ...overrides
  }
}

function account(id: string): ProviderAccount {
  return { id, provider: 'codex', name: id, authMode: 'oauth', active: false, createdAt: 1, lastUsed: 1, codexAuthMode: 'oauth' }
}

let server: GatewayServerHandle | null = null

async function withServer(cfg: GatewayConfig, accounts: ProviderAccount[] = [account('acc-1')], secrets: Record<string, ConnectionSecrets> = { 'acc-1': { tokens: { accessToken: 'at-1', expiresAt: Date.now() + 1e6, lastRefresh: 1 } } }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-gw-'))
  const logs = new GatewayLogStore(dir)
  const health = new Map<string, AccountHealth>()
  server = await startGatewayServer({
    getConfig: () => cfg,
    getAccounts: () => accounts,
    getSecrets: id => secrets[id] ?? {},
    health,
    logs
  }, cfg.port || 0)
  return { base: `http://127.0.0.1:${server.port}`, logs, health }
}

afterEach(async () => {
  if (server) { await server.close(); server = null }
  fetchMock.mockReset()
})

describe('gateway server', () => {
  it('returns 401 when the gateway apiKey is missing or wrong', async () => {
    const { base } = await withServer(makeCfg())
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}'
    })
    expect(res.status).toBe(401)
  })

  it('returns 503 when gateway is disabled', async () => {
    const { base } = await withServer(makeCfg({ enabled: false }))
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer gw-key' }, body: '{}'
    })
    expect(res.status).toBe(503)
  })

  it('forwards chat completions to the selected account and logs it', async () => {
    mockUpstream()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { base, logs } = await withServer(makeCfg())
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: 'Bearer gw-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] })
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/chat/completions')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-1' })
    const entries = logs.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ status: 200, accountId: 'acc-1', model: 'gpt-4o', tokensIn: 10, tokensOut: 5 })
  })

  it('blocks the account on upstream 429 and picks another on the next request', async () => {
    mockUpstream()
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    const { base, health } = await withServer(makeCfg(), [account('acc-1'), account('acc-2')], {
      'acc-1': { tokens: { accessToken: 'at-1', expiresAt: Date.now() + 1e6, lastRefresh: 1 } },
      'acc-2': { tokens: { accessToken: 'at-2', expiresAt: Date.now() + 1e6, lastRefresh: 1 } }
    })
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] })
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer gw-key', 'content-type': 'application/json' }, body })
    expect(res.status).toBe(429)
    expect(health.get('acc-1')?.blockedUntil).toBeGreaterThan(Date.now())
    // Second request: acc-1 blocked, acc-2 used.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const res2 = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer gw-key', 'content-type': 'application/json' }, body })
    expect(res2.status).toBe(200)
    const lastCall = fetchMock.mock.calls.at(-1)
    expect(String(lastCall?.[0])).toContain('/chat/completions')
    expect((lastCall?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-2' })
  })

  it('returns 429 when all accounts are blocked', async () => {
    mockUpstream()
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    const { base } = await withServer(makeCfg())
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] })
    await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer gw-key' }, body })
    const res2 = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer gw-key' }, body })
    expect(res2.status).toBe(429)
    const parsed = await res2.json() as { error: { type?: string } }
    expect(parsed.error.type).toBe('no_available_account')
  })

  it('serves /v1/models', async () => {
    mockUpstream()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { base } = await withServer(makeCfg())
    const res = await fetch(`${base}/v1/models`, { headers: { authorization: 'Bearer gw-key' } })
    expect(res.status).toBe(200)
    const parsed = await res.json() as { data?: Array<{ id: string }> }
    expect(parsed.data?.some(m => m.id === 'gpt-4o')).toBe(true)
  })
})
