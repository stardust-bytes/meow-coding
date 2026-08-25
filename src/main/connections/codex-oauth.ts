import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthTokens } from './types'

// Documented Codex OAuth client identity and endpoints (same as the Codex CLI
// and CLIProxyAPI v7.1.22). auth.openai.com only accepts the redirect URIs
// registered for this client: http://localhost:1455/auth/callback (primary)
// and http://localhost:1457/auth/callback (fallback). A random port or a
// different path is rejected with invalid_authorize_request.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_SCOPES = 'openid profile email offline_access'
const CODEX_ORIGINATOR = 'codex_vscode'
const CODEX_AUTH_USER_AGENT = 'codex_vscode/0.146.0'
const CODEX_CALLBACK_PORTS = [1455, 1457]
const CODEX_CALLBACK_PATH = '/auth/callback'
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
  /** Registered callback ports accepted by auth.openai.com (1455 + 1457). */
  callbackPorts?: number[]
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
  private readonly deps: Required<Pick<CodexOAuthDeps, 'fetchFn' | 'randomBytes' | 'now' | 'host' | 'callbackTimeoutMs' | 'callbackPorts'>> & CodexOAuthDeps
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
      callbackPorts: deps.callbackPorts ?? CODEX_CALLBACK_PORTS,
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

    // Bind the registered callback port (1455, fallback 1457). auth.openai.com
    // validates the exact redirect_uri, so a random port would be rejected.
    const { server, port } = await this.bindCallbackServer()
    const redirectUri = `http://localhost:${port}${CODEX_CALLBACK_PATH}`

    const callback = new Promise<{ code: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new CodexOAuthError('OAuth callback timed out'))
      }, this.deps.callbackTimeoutMs)
      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
      // Forward post-listen errors (e.g. reset connections) so authorize()
      // does not hang until the callback timeout.
      server.on('error', fail)
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

    // Parameter set mirrors the official Codex CLI / cockpit-tools: no
    // prompt, originator + org/scoped flags are required by auth.openai.com.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: CODEX_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: CODEX_ORIGINATOR
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

  private async bindCallbackServer(): Promise<{ server: http.Server; port: number }> {
    let lastError: unknown
    for (const requested of this.deps.callbackPorts) {
      const server = http.createServer()
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(requested, this.deps.host, resolve)
        })
        // With port 0 the OS assigns an ephemeral port; always read the actual
        // bound port so the redirect_uri matches the listener.
        const bound = (server.address() as AddressInfo).port
        return { server, port: bound }
      } catch (err) {
        lastError = err
        server.close()
      }
    }
    throw new CodexOAuthError(
      `Không thể mở callback OAuth (port ${this.deps.callbackPorts.join(', ')} đang bận). Đóng ứng dụng khác đang chiếm port rồi thử lại.`
    )
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
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': CODEX_AUTH_USER_AGENT,
        originator: CODEX_ORIGINATOR
      },
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
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': CODEX_AUTH_USER_AGENT,
        originator: CODEX_ORIGINATOR
      },
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
