import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { CodexOAuth, CodexOAuthError } from '../../src/main/connections/codex-oauth'
import type { OAuthTokens } from '../../src/main/connections/types'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'

function idToken(payload: Record<string, unknown>): string {
  const enc = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.sig`
}

function tokenResponse(overrides: Partial<{ accessToken: string; refreshToken: string; email: string; expiresIn: number }> = {}) {
  const email = overrides.email ?? 'dev@example.com'
  return {
    access_token: overrides.accessToken ?? 'access-token',
    refresh_token: overrides.refreshToken ?? 'refresh-token',
    id_token: idToken({ email, sub: 'user-1', name: 'Dev' }),
    token_type: 'Bearer',
    expires_in: overrides.expiresIn ?? 3600
  }
}

function makeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = await (init?.body as BodyInit | undefined)?.toString?.()
    return handler(url, { ...init, body })
  })
}

function fetchJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function waitForAuthUrl(openExternal: ReturnType<typeof vi.fn>): Promise<URL> {
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalled())
  return new URL(openExternal.mock.calls[0][0])
}

function callbackUrl(authUrl: URL): URL {
  const redirect = authUrl.searchParams.get('redirect_uri')!
  // The callback server binds 127.0.0.1; fetch the IPv4 form so Node's fetch
  // does not try ::1 first (browsers fall back to IPv4 automatically).
  return new URL(redirect.replace('localhost', '127.0.0.1'))
}

describe('CodexOAuth', () => {
  it('authorizes with PKCE and returns profile plus tokens', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch((url) => {
      expect(url).toBe(TOKEN_URL)
      return fetchJson(tokenResponse())
    })
    const oauth = new CodexOAuth({ openExternal, fetchFn, callbackPorts: [0] })

    const pending = oauth.authorize(); pending.catch(() => {})
    const authUrl = await waitForAuthUrl(openExternal)
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy()
    expect(authUrl.searchParams.get('code_challenge')).not.toBe(authUrl.searchParams.get('state'))
    // auth.openai.com requires these identity/flow params and the registered
    // loopback redirect_uri (localhost:<registered port>/auth/callback).
    expect(authUrl.searchParams.get('originator')).toBe('codex_vscode')
    expect(authUrl.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(authUrl.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(authUrl.searchParams.get('prompt')).toBeNull()
    const redirectUri = authUrl.searchParams.get('redirect_uri')!
    expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/auth\/callback$/)
    const state = authUrl.searchParams.get('state')!

    const redirectUrl = callbackUrl(authUrl)
    redirectUrl.searchParams.set('code', 'auth-code')
    redirectUrl.searchParams.set('state', state)
    await fetch(redirectUrl.toString())

    const result = await pending
    expect(result).toMatchObject({
      email: 'dev@example.com',
      displayName: 'Dev',
      tokens: expect.objectContaining({ refreshToken: 'refresh-token', accessToken: 'access-token' })
    })
    expect(result.tokens.accessTokenExpiresAt).toBeDefined()
    // The exchange request must carry the PKCE verifier.
    const exchangeBody = fetchFn.mock.calls[0][1]?.body as string
    expect(exchangeBody).toContain('grant_type=authorization_code')
    expect(exchangeBody).toContain('code_verifier=')
  })

  it('rejects a callback with a mismatched state', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch(() => fetchJson(tokenResponse()))
    const oauth = new CodexOAuth({ openExternal, fetchFn, callbackPorts: [0] })

    const pending = oauth.authorize(); pending.catch(() => {})
    const authUrl = await waitForAuthUrl(openExternal)
    const redirectUrl = callbackUrl(authUrl)
    redirectUrl.searchParams.set('code', 'auth-code')
    redirectUrl.searchParams.set('state', 'wrong-state')
    await fetch(redirectUrl.toString())

    await expect(pending).rejects.toThrow(/state/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('times out the callback and cleans up', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch(() => fetchJson(tokenResponse()))
    const oauth = new CodexOAuth({ openExternal, fetchFn, callbackTimeoutMs: 30, callbackPorts: [0] })

    await expect(oauth.authorize()).rejects.toThrow(CodexOAuthError)
  })

  it('refreshes tokens before expiry', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch((url) => {
      expect(url).toBe(TOKEN_URL)
      return fetchJson(tokenResponse({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 7200 }))
    })
    const oauth = new CodexOAuth({ openExternal, fetchFn, callbackPorts: [0] })
    const tokens: OAuthTokens = {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
    }
    const refreshed = await oauth.refreshTokens(tokens)
    expect(refreshed.accessToken).toBe('new-access')
    expect(refreshed.refreshToken).toBe('new-refresh')
    const body = fetchFn.mock.calls[0][1]?.body as string
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('old-refresh')
  })

  it('fails when refresh has no token', async () => {
    const openExternal = vi.fn(async () => {})
    const oauth = new CodexOAuth({ openExternal, fetchFn: makeFetch(() => fetchJson(tokenResponse())) })
    const tokens: OAuthTokens = {
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString()
    }
    await expect(oauth.refreshTokens(tokens)).rejects.toThrow(/refresh token/i)
  })

  it('fails when the token exchange returns an error status', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch(() => new Response('{"error":"invalid_grant"}', { status: 400 }))
    const oauth = new CodexOAuth({ openExternal, fetchFn, callbackPorts: [0] })
    const pending = oauth.authorize(); pending.catch(() => {})
    const authUrl = await waitForAuthUrl(openExternal)
    const redirectUrl = callbackUrl(authUrl)
    redirectUrl.searchParams.set('code', 'bad-code')
    redirectUrl.searchParams.set('state', authUrl.searchParams.get('state')!)
    await fetch(redirectUrl.toString())
    await expect(pending).rejects.toThrow(/token/i)
  })

  it('generates verifier and challenge with injected randomness', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = makeFetch(() => fetchJson(tokenResponse()))
    const fixed = Buffer.from('a'.repeat(32))
    const oauth = new CodexOAuth({
      openExternal,
      fetchFn,
      callbackPorts: [0],
      randomBytes: (n) => fixed.subarray(0, n)
    })
    const pending = oauth.authorize(); pending.catch(() => {})
    const authUrl = await waitForAuthUrl(openExternal)
    const verifier = Buffer.from(fixed).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(authUrl.searchParams.get('code_challenge')).toBe(challenge)
    const redirectUrl = callbackUrl(authUrl)
    redirectUrl.searchParams.set('code', 'c')
    redirectUrl.searchParams.set('state', authUrl.searchParams.get('state')!)
    await fetch(redirectUrl.toString())
    await pending
  })
})
