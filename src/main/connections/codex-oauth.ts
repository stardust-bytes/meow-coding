import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthTokens } from './types'

// Documented Codex OAuth client identity and endpoints (same as the Codex CLI
// and CLIProxyAPI v7.1.22). Tokens are exchanged only over loopback callbacks.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_SCOPES = 'openid email profile offline_access'
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export class CodexOAuthError extends Error {}

export interface CodexOAuthDeps {
  openExternal: (url: string) => Promise<void>
  fetchFn?: typeof fetch
  randomBytes?: (n: number) => Buffer
  now?: () => number
  /** Loopback bind host; never expose the callback on LAN interfaces. */
  host?: string
  callbackTimeoutMs?: number
  oauth?: {
    clientId: string
    authUrl: string
    tokenUrl: string
  }
}

export interface CodexAuthorizeResult {
  email?: string
  displayName: string
  /** Stable account identifier from the ID token subject claim. */
  accountId?: string
  tokens: OAuthTokens
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
}

function base64Url(input: Buffer): string {
  return input.toString('base64url')
}

function decodeIdToken(idToken: string): Record<string, unknown> | null {
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractProfile(idToken: string | undefined): { email?: string; displayName: string; accountId?: string } {
  if (!idToken) return { displayName: 'Codex account' }
  const claims = decodeIdToken(idToken)
  const email = typeof claims?.email === 'string' ? claims.email : undefined
  const name = typeof claims?.name === 'string' ? claims.name : undefined
  const sub = typeof claims?.sub === 'string' ? claims.sub : undefined
  const displayName = name || email || (sub ? `Codex account ${sub.slice(0, 8)}` : 'Codex account')
  return { email, displayName, accountId: sub }
}

export class CodexOAuth {
  private readonly deps: Required<Pick<CodexOAuthDeps, 'fetchFn' | 'randomBytes' | 'now' | 'host' | 'callbackTimeoutMs'>> & CodexOAuthDeps
  private readonly clientId: string
  private readonly authUrl: string
  private readonly tokenUrl: string

  constructor(deps: CodexOAuthDeps) {
    this.deps = {
      fetchFn: deps.fetchFn ?? fetch.bind(globalThis),
      randomBytes: deps.randomBytes ?? nodeRandomBytes,
      now: deps.now ?? Date.now,
      host: deps.host ?? '127.0.0.1',
      callbackTimeoutMs: deps.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS,
      ...deps
    }
    this.clientId = deps.oauth?.clientId ?? CODEX_CLIENT_ID
    this.authUrl = deps.oauth?.authUrl ?? CODEX_AUTH_URL
    this.tokenUrl = deps.oauth?.tokenUrl ?? CODEX_TOKEN_URL
  }

  async authorize(): Promise<CodexAuthorizeResult> {
    const verifier = base64Url(this.deps.randomBytes(32))
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = base64Url(this.deps.randomBytes(16))

    const server = http.createServer()

    const callback = new Promise<{ code: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new CodexOAuthError('OAuth callback timed out'))
      }, this.deps.callbackTimeoutMs)
      let settled = false
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', `http://${this.deps.host}`)
        const receivedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><body>You can close this window and return to Meow Coding.</body></html>')
        if (settled) return
        if (receivedState !== state) {
          settled = true
          clearTimeout(timeout)
          reject(new CodexOAuthError('OAuth callback state mismatch'))
          return
        }
        if (!code) {
          const error = url.searchParams.get('error') ?? 'missing authorization code'
          settled = true
          clearTimeout(timeout)
          reject(new CodexOAuthError(`OAuth authorization failed: ${error}`))
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve({ code })
      })
    })

    // Avoid unhandled rejections when authorize() leaves via another path
    // (openExternal failure) while the callback timer is still pending.
    callback.catch(() => {})

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, this.deps.host, resolve)
    })

    const port = (server.address() as AddressInfo).port
    const redirectUri = `http://${this.deps.host}:${port}/callback`
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: CODEX_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'login'
    })

    try {
      await this.deps.openExternal(`${this.authUrl}?${params.toString()}`)
      const { code } = await callback
      const tokens = await this.exchangeCode(code, redirectUri, verifier)
      const profile = extractProfile(tokens.idToken)
      return { ...profile, tokens }
    } finally {
      server.close()
      server.closeAllConnections?.()
    }
  }

  async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (!tokens.refreshToken) {
      throw new CodexOAuthError('Cannot refresh: refresh token is missing')
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      scope: 'openid profile email'
    })
    const raw = await this.deps.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString()
    })
    if (!raw.ok) throw new CodexOAuthError(`Token refresh failed (HTTP ${raw.status})`)
    const parsed = await raw.json() as TokenResponse
    if (!parsed.access_token) throw new CodexOAuthError('Token refresh returned no access token')
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? tokens.refreshToken,
      idToken: parsed.id_token ?? tokens.idToken,
      accessTokenExpiresAt: new Date(this.deps.now() + (parsed.expires_in ?? 3600) * 1000).toISOString()
    }
  }

  private async exchangeCode(code: string, redirectUri: string, verifier: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: 'openid profile email'
    })
    const raw = await this.deps.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString()
    })
    if (!raw.ok) throw new CodexOAuthError(`Token exchange failed (HTTP ${raw.status})`)
    const parsed = await raw.json() as TokenResponse
    if (!parsed.access_token) throw new CodexOAuthError('Token exchange returned no access token')
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      idToken: parsed.id_token,
      accessTokenExpiresAt: new Date(this.deps.now() + (parsed.expires_in ?? 3600) * 1000).toISOString()
    }
  }
}
