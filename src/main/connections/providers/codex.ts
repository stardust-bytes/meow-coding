import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProviderAccount, QuotaInfo } from '../../../shared/types'
import { decodeJwtPayload, generateCodeVerifier, generatePkceChallenge, generateState, startCallbackServer } from '../oauth'
import type { AdapterContext, LoginContext, ProviderAdapter } from '../manager'
import type { ConnectionSecrets } from '../types'

// Codex CLI OAuth — verified against cockpit-tools codex_oauth.rs. Redirect is
// a localhost callback we bind ourselves (port 1455 by default). OpenAI's auth
// server checks the User-Agent/originator identity, so we impersonate the
// official codex_vscode client (same as cockpit does).
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const ORIGINATOR = 'codex_vscode'
const AUTH_USER_AGENT = 'codex_vscode/0.146.0'
const PREFERRED_PORT = 1455
const EXPIRY_SKEW_MS = 5 * 60 * 1000

export function getCodexAuthJsonPath(): string {
  return path.join(homedir(), '.codex', 'auth.json')
}

function getBackupPath(): string {
  return path.join(homedir(), '.codex', 'auth.json.meow-backup')
}

interface CodexTokens {
  idToken: string
  accessToken: string
  refreshToken?: string
  accountId?: string
}

function toTokensSecrets(t: CodexTokens): NonNullable<ConnectionSecrets['tokens']> {
  const now = Date.now()
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    idToken: t.idToken,
    expiresAt: now + 24 * 3600 * 1000,
    lastRefresh: now
  }
}

function authHeaders(): Record<string, string> {
  return { 'User-Agent': AUTH_USER_AGENT, originator: ORIGINATOR }
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`)
  }
}

async function exchangeCode(port: number, code: string, verifier: string): Promise<CodexTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `http://localhost:${port}/auth/callback`,
    client_id: CLIENT_ID,
    code_verifier: verifier
  })
  const body = await fetchJson(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...authHeaders() },
    body: params.toString()
  })
  const accessToken = typeof body['access_token'] === 'string' ? body['access_token'] : undefined
  if (!accessToken) throw new Error('[meow] Phản hồi OAuth Codex thiếu access_token')
  const idToken = typeof body['id_token'] === 'string' ? body['id_token'] : undefined
  const payload = idToken ? decodeJwtPayload<Record<string, unknown>>(idToken) : null
  const auth = payload?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined
  return {
    idToken: idToken ?? '',
    accessToken,
    refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : undefined,
    accountId: typeof auth?.['account_id'] === 'string' ? auth['account_id'] as string : undefined
  }
}

async function refreshTokens(t: CodexTokens): Promise<CodexTokens> {
  if (!t.refreshToken) return t
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refreshToken,
    client_id: CLIENT_ID
  })
  const body = await fetchJson(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...authHeaders() },
    body: params.toString()
  })
  const accessToken = typeof body['access_token'] === 'string' ? body['access_token'] : undefined
  if (!accessToken) throw new Error('[meow] Refresh token Codex thất bại')
  return {
    idToken: typeof body['id_token'] === 'string' ? body['id_token'] : t.idToken,
    accessToken,
    refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : t.refreshToken,
    accountId: t.accountId
  }
}

function emailFromIdToken(t: CodexTokens): string | undefined {
  const payload = t.idToken ? decodeJwtPayload<{ email?: string }>(t.idToken) : null
  return payload?.email
}

// Merge our account's tokens into ~/.codex/auth.json, preserving any existing
// keys (Codex CLI may add fields we do not know about). Writes atomically via
// temp file + rename; backs up the original on first switch.
export function writeCodexAuthFile(account: ProviderAccount, secrets: ConnectionSecrets): void {
  const authPath = getCodexAuthJsonPath()
  const dir = path.dirname(authPath)
  mkdirSync(dir, { recursive: true })

  if (existsSync(authPath) && !existsSync(getBackupPath())) {
    copyFileSync(authPath, getBackupPath())
  }

  const existing: Record<string, unknown> = existsSync(authPath)
    ? (() => { try { return JSON.parse(readFileSync(authPath, 'utf-8')) as Record<string, unknown> } catch { return {} } })()
    : {}

  let next: Record<string, unknown>
  if (account.codexAuthMode === 'apikey') {
    next = { ...existing, auth_mode: 'apikey', OPENAI_API_KEY: secrets.apiKey ?? null }
  } else {
    const tokens = secrets.tokens
    if (!tokens?.accessToken) throw new Error('[meow] Thiếu token OAuth Codex')
    next = {
      ...existing,
      auth_mode: 'oauth',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: tokens.idToken ?? '',
        access_token: tokens.accessToken,
        ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
        ...(account.profile?.orgName ? { account_id: account.profile.orgName } : {})
      },
      last_refresh: tokens.lastRefresh
    }
  }
  const tmp = `${authPath}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, authPath)
}

export function restoreCodexAuthFile(): void {
  const backup = getBackupPath()
  if (!existsSync(backup)) return
  renameSync(backup, getCodexAuthJsonPath())
}

// Codex quota — usage + subscription endpoints on chatgpt.com.
async function fetchCodexQuota(secrets: ConnectionSecrets): Promise<QuotaInfo | null> {
  const tokens = secrets.tokens
  if (!tokens?.accessToken) return null
  try {
    const usage = await fetchJson('https://chatgpt.com/backend-api/wham/usage', {
      headers: { authorization: `Bearer ${tokens.accessToken}`, ...authHeaders() }
    })
    const planType = typeof usage['plan_type'] === 'string' ? usage['plan_type'] as string : undefined
    const usageNum = typeof usage['usage'] === 'number' ? usage['usage'] as number : undefined
    const limit = typeof usage['limit'] === 'number' ? usage['limit'] as number : undefined
    return {
      provider: 'codex',
      planType,
      used: usageNum,
      limit,
      ...(usageNum !== undefined && limit !== undefined ? { remaining: Math.max(0, limit - usageNum) } : {}),
      raw: usage,
      refreshedAt: Date.now()
    }
  } catch {
    return null
  }
}

export const codexAdapter: ProviderAdapter = {
  provider: 'codex',

  async loginStart(ctx: AdapterContext & LoginContext): Promise<{ authUrl: string; mode: 'callback'; expiresIn: number }> {
    const codeVerifier = generateCodeVerifier()
    const state = generateState()
    ctx.codeVerifier = codeVerifier
    ctx.state = state

    let server: Awaited<ReturnType<typeof startCallbackServer>>
    try {
      server = await startCallbackServer({ preferredPort: PREFERRED_PORT, expectedState: state })
    } catch (err) {
      if (String(err).includes('EADDRINUSE')) {
        throw new Error(`CODEX_OAUTH_PORT_IN_USE: port ${PREFERRED_PORT} đang được dùng bởi tiến trình khác`)
      }
      throw err
    }
    ctx.callbackServer = server
    ctx.callbackPort = server.port

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `http://localhost:${server.port}/auth/callback`,
      scope: SCOPES,
      code_challenge: generatePkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: ORIGINATOR
    })
    return { authUrl: `${AUTH_ENDPOINT}?${params.toString()}`, mode: 'callback', expiresIn: 300 }
  },

  async loginSubmit(ctx: AdapterContext & LoginContext, code: string): Promise<ProviderAccount> {
    // Callback mode: if no code was pasted, await the local callback server.
    let finalCode = code
    let port = ctx.callbackPort ?? PREFERRED_PORT
    if (!finalCode) {
      const server = ctx.callbackServer
      if (!server) throw new Error('[meow] Callback server Codex không tồn tại')
      const params = await server.waitForCallback(5 * 60 * 1000)
      finalCode = params['code'] ?? ''
      if (!finalCode) throw new Error('[meow] Callback Codex thiếu code')
      port = server.port
    }
    const tokens = await exchangeCode(port, finalCode, ctx.codeVerifier ?? '')
    const email = emailFromIdToken(tokens)
    const id = randomUUID()
    const account: ProviderAccount = {
      id,
      provider: 'codex',
      name: email ?? 'Codex account',
      authMode: 'oauth',
      active: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      codexAuthMode: 'oauth',
      profile: email ? { email } : undefined
    }
    if (tokens.accountId) {
      account.profile = { ...(account.profile ?? {}), orgName: tokens.accountId }
    }
    ctx.store.setTokens(id, toTokensSecrets(tokens))
    writeCodexAuthFile(account, ctx.store.getSecrets(id))
    return account
  },

  async onSwitch(account: ProviderAccount, ctx: AdapterContext): Promise<void> {
    const secrets = ctx.store.getSecrets(account.id)
    if (account.codexAuthMode === 'apikey' && !secrets.apiKey) return
    if (account.codexAuthMode !== 'apikey' && !secrets.tokens?.accessToken) return
    writeCodexAuthFile(account, secrets)
  },

  async onRemove(account: ProviderAccount): Promise<void> {
    if (account.codexAuthMode !== 'apikey') {
      // Only restore the backup if the current file is one we wrote.
      const backup = getBackupPath()
      if (!existsSync(backup) || !existsSync(getCodexAuthJsonPath())) return
      try {
        const cur = JSON.parse(readFileSync(getCodexAuthJsonPath(), 'utf-8')) as Record<string, unknown>
        if (cur['auth_mode'] === 'oauth' && cur['tokens']) {
          restoreCodexAuthFile()
        }
      } catch { /* ignore */ }
    }
  },

  buildSpawnEnv(account, secrets): Record<string, string> {
    const env: Record<string, string> = { ...(account.extraEnv ?? {}) }
    if (account.codexAuthMode === 'apikey' && secrets.apiKey) {
      env['OPENAI_API_KEY'] = secrets.apiKey
    }
    return env
  },

  async refreshQuota(account, secrets, ctx): Promise<QuotaInfo | null> {
    const tokens = secrets.tokens
    if (!tokens?.accessToken) return null
    let current = tokens
    if (current.expiresAt - Date.now() < EXPIRY_SKEW_MS && current.refreshToken) {
      const refreshed = await refreshTokens({
        idToken: current.idToken ?? '',
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        accountId: account.profile?.orgName
      })
      current = toTokensSecrets(refreshed)
      ctx.store.setTokens(account.id, current)
    }
    return fetchCodexQuota({ tokens: current })
  },

  async importFromJson(json: string, ctx: AdapterContext): Promise<ProviderAccount> {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const id = randomUUID()
    const account: ProviderAccount = {
      id,
      provider: 'codex',
      name: typeof parsed['email'] === 'string' ? parsed['email'] as string : 'Imported Codex',
      authMode: 'imported',
      active: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      codexAuthMode: parsed['auth_mode'] === 'apikey' || typeof parsed['OPENAI_API_KEY'] === 'string' ? 'apikey' : 'oauth'
    }
    const tokensRaw = parsed['tokens'] as Record<string, unknown> | undefined
    if (account.codexAuthMode === 'apikey' && typeof parsed['OPENAI_API_KEY'] === 'string') {
      ctx.store.setApiKey(id, parsed['OPENAI_API_KEY'] as string)
    } else if (tokensRaw && typeof tokensRaw['access_token'] === 'string') {
      ctx.store.setTokens(id, {
        accessToken: tokensRaw['access_token'] as string,
        refreshToken: typeof tokensRaw['refresh_token'] === 'string' ? tokensRaw['refresh_token'] as string : undefined,
        idToken: typeof tokensRaw['id_token'] === 'string' ? tokensRaw['id_token'] as string : undefined,
        expiresAt: Date.now() + 24 * 3600 * 1000,
        lastRefresh: Date.now()
      })
      if (typeof tokensRaw['account_id'] === 'string') {
        account.profile = { orgName: tokensRaw['account_id'] as string }
      }
      if (typeof parsed['email'] === 'string') {
        account.profile = { ...(account.profile ?? {}), email: parsed['email'] as string }
      }
    } else {
      throw new Error('[meow] JSON Codex không hợp lệ (thiếu tokens hoặc OPENAI_API_KEY)')
    }
    return account
  }
}
