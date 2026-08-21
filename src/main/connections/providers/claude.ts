import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProviderAccount, QuotaInfo } from '../../../shared/types'
import { generateCodeVerifier, generatePkceChallenge, generateState } from '../oauth'
import type { AdapterContext, LoginContext, ProviderAdapter } from '../manager'
import type { ConnectionSecrets } from '../types'

// Constants mirror the official Claude Code OAuth flow (verified against
// cockpit-tools src-tauri/src/modules/claude_account.rs). The redirect_uri is
// Anthropic-hosted, so we cannot bind a local callback — the user pastes the
// `code` from the redirect URL back into the app.
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const BETA_HEADER = 'oauth-2025-04-20'
const SCOPES = [
  'org:create_api_key', 'user:profile', 'user:inference',
  'user:sessions:claude_code', 'user:mcp_servers', 'user:file_upload'
].join(' ')
const EXPIRY_SKEW_MS = 5 * 60 * 1000

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

function readString(obj: unknown, keys: string[]): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

// Quota percentages come from the oauth/profile response under
// endpoints.organizationUsage (flexible path shapes) and plan from
// endpoints.subscriptionDetails.plan_type.
export function parseClaudeQuota(profile: Record<string, unknown>, refreshedAt: number): QuotaInfo | null {
  const endpoints = (profile as Record<string, unknown>)['endpoints'] as Record<string, unknown> | undefined
  const orgUsage = endpoints?.['organizationUsage'] as Record<string, unknown> | undefined
  const subDetails = endpoints?.['subscriptionDetails'] as Record<string, unknown> | undefined
  if (!orgUsage && !subDetails) return null

  const num = (v: unknown): number | undefined => typeof v === 'number' ? v : undefined
  const fiveHour = orgUsage?.['five_hour'] as Record<string, unknown> | undefined
    ?? orgUsage?.['fiveHour'] as Record<string, unknown> | undefined
  const sevenDay = orgUsage?.['seven_day'] as Record<string, unknown> | undefined
    ?? orgUsage?.['sevenDay'] as Record<string, unknown> | undefined

  const used = num(orgUsage?.['percentUsed'])
    ?? num(fiveHour?.['utilization'])
    ?? num(orgUsage?.['five_hour_percentage'])
  const sevenDayUsed = num(sevenDay?.['utilization'])
    ?? num(sevenDay?.['percentage'])
  const planType = readString(subDetails, ['plan_type', 'planType'])

  return {
    provider: 'claude',
    planType,
    used: used ?? sevenDayUsed,
    limit: 100,
    raw: profile,
    refreshedAt
  }
}

function claudeConfigDir(baseDir: string, accountId: string): string {
  return path.join(baseDir, 'claude', accountId)
}

// Writes the .credentials.json + settings.json that Claude Code CLI reads from
// CLAUDE_CONFIG_DIR. Format verified against cockpit-tools.
export function writeClaudeCredentials(
  configDir: string,
  secrets: ConnectionSecrets,
  profile?: ProviderAccount['profile']
): void {
  const tokens = secrets.tokens
  if (!tokens) throw new Error('[meow] Thiếu token OAuth Claude')
  mkdirSync(configDir, { recursive: true })
  const oauth: Record<string, unknown> = {
    accessToken: tokens.accessToken,
    lastRefresh: tokens.lastRefresh
  }
  if (tokens.refreshToken) oauth.refreshToken = tokens.refreshToken
  if (tokens.idToken) oauth.idToken = tokens.idToken
  writeFileSync(path.join(configDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }, null, 2))
  const oauthAccount: Record<string, unknown> = {}
  if (profile?.email) oauthAccount.emailAddress = profile.email
  if (profile?.name) oauthAccount.displayName = profile.name
  if (profile?.orgName) oauthAccount.organizationName = profile.orgName
  if (profile?.avatarUrl) oauthAccount.avatarUrl = profile.avatarUrl
  writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ oauthAccount, hasCompletedOnboarding: true }, null, 2))
}

async function exchangeCode(ctx: AdapterContext & LoginContext, code: string): Promise<NonNullable<ConnectionSecrets['tokens']>> {
  const body = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: ctx.codeVerifier,
      state: ctx.state
    })
  })
  const accessToken = readString(body, ['access_token'])
  if (!accessToken) throw new Error('[meow] Phản hồi OAuth Claude thiếu access_token')
  const now = Date.now()
  return {
    accessToken,
    refreshToken: readString(body, ['refresh_token']),
    idToken: readString(body, ['id_token']),
    expiresAt: now + (typeof body['expires_in'] === 'number' ? body['expires_in'] * 1000 : 3600 * 1000),
    lastRefresh: now
  }
}

async function refreshTokens(tokens: NonNullable<ConnectionSecrets['tokens']>): Promise<NonNullable<ConnectionSecrets['tokens']>> {
  if (!tokens.refreshToken) return tokens
  const body = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: tokens.refreshToken
    })
  })
  const accessToken = readString(body, ['access_token'])
  if (!accessToken) throw new Error('[meow] Refresh token Claude thất bại')
  const now = Date.now()
  return {
    accessToken,
    refreshToken: readString(body, ['refresh_token']) ?? tokens.refreshToken,
    idToken: readString(body, ['id_token']) ?? tokens.idToken,
    expiresAt: now + (typeof body['expires_in'] === 'number' ? body['expires_in'] * 1000 : 3600 * 1000),
    lastRefresh: now
  }
}

async function fetchProfile(accessToken: string): Promise<Record<string, unknown>> {
  return fetchJson(PROFILE_URL, {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
  })
}

function profileToAccountProfile(profile: Record<string, unknown>): ProviderAccount['profile'] {
  const account = profile['account'] as Record<string, unknown> | undefined
  const org = profile['organization'] as Record<string, unknown> | undefined
  return {
    email: readString(account, ['email', 'email_address']) ?? readString(profile, ['email']),
    name: readString(account, ['display_name', 'displayName']) ?? readString(account, ['name']),
    orgName: readString(org, ['name', 'display_name', 'displayName']),
    avatarUrl: readString(account, ['avatar_url', 'avatarUrl'])
  }
}

function buildSpawnEnvFromSecrets(account: ProviderAccount, secrets: ConnectionSecrets): Record<string, string> {
  const env: Record<string, string> = { ...(account.extraEnv ?? {}) }
  if (secrets.apiKey) {
    const field = account.apiKeyField ?? (account.apiBaseUrl ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY')
    env[field] = secrets.apiKey
    if (account.apiBaseUrl) env['ANTHROPIC_BASE_URL'] = account.apiBaseUrl
    return env
  }
  if (account.claudeConfigDir) {
    env['CLAUDE_CONFIG_DIR'] = account.claudeConfigDir
    return env
  }
  if (secrets.tokens?.accessToken) {
    env['ANTHROPIC_AUTH_TOKEN'] = secrets.tokens.accessToken
  }
  return env
}

// Users may paste the full callback URL, a query-like string, or the raw code
// from Anthropic's manual-code page. Extract code + state robustly (mirrors
// cockpit-tools parse_oauth_callback_input / clean_authorization_code).
function cleanAuthorizationCode(raw: string): { code: string; state?: string } {
  let code = raw.trim()
  let state: string | undefined
  const hashIdx = code.indexOf('#')
  if (hashIdx >= 0) {
    state = code.slice(hashIdx + 1)
    code = code.slice(0, hashIdx)
  }
  const ampIdx = code.indexOf('&')
  if (ampIdx >= 0) code = code.slice(0, ampIdx)
  return { code: code.trim(), state }
}

export function parseOauthCallbackInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('[meow] Hãy dán code hoặc URL callback')

  let parsedUrl: URL | null = null
  try {
    const url = new URL(trimmed)
    parsedUrl = url
    if (url.hostname === 'claude.com' && url.pathname === '/cai/oauth/authorize') {
      throw new Error('[meow] Đây là URL authorize, không phải callback — hãy dán URL sau khi đăng nhập xong')
    }
    const codeParam = url.searchParams.get('code')
    if (codeParam) {
      const { code } = cleanAuthorizationCode(codeParam)
      return { code, state: url.searchParams.get('state') ?? undefined }
    }
    if (url.hash) {
      const pairs = new URLSearchParams(url.hash.replace(/^#/, ''))
      const fragCode = pairs.get('code')
      if (fragCode) {
        const { code } = cleanAuthorizationCode(fragCode)
        return { code, state: pairs.get('state') ?? undefined }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[meow]')) throw err
    // Not a URL — fall through to query-like / raw code handling.
  }
  if (parsedUrl) {
    throw new Error('[meow] Không tìm thấy tham số code trong URL — hãy dán URL chứa code=...')
  }

  if (
    trimmed.startsWith('code=') || trimmed.startsWith('state=') ||
    trimmed.includes('&code=') || trimmed.includes('?code=')
  ) {
    const query = trimmed.split('?')[1] ?? trimmed
    const pairs = new URLSearchParams(query)
    const codeParam = pairs.get('code')
    if (codeParam) {
      const { code } = cleanAuthorizationCode(codeParam)
      return { code, state: pairs.get('state') ?? undefined }
    }
  }

  const { code, state } = cleanAuthorizationCode(trimmed)
  const cleaned = code.startsWith('code=') ? code.slice('code='.length) : code
  if (!cleaned) throw new Error('[meow] Không tìm thấy code trong dữ liệu dán vào')
  return { code: cleaned, state }
}

export const claudeAdapter: ProviderAdapter = {
  provider: 'claude',

  async loginStart(ctx: AdapterContext & LoginContext): Promise<Omit<import('../../../shared/types').LoginStart, 'loginId' | 'provider'>> {
    const codeVerifier = generateCodeVerifier()
    const state = generateState()
    ctx.codeVerifier = codeVerifier
    ctx.state = state
    const params = new URLSearchParams({
      code: 'true',
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: generatePkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state
    })
    return { authUrl: `${AUTHORIZE_URL}?${params.toString()}`, mode: 'browser-code', expiresIn: 300 }
  },

  async loginSubmit(ctx: AdapterContext & LoginContext, code: string): Promise<ProviderAccount> {
    const { code: cleanCode, state } = parseOauthCallbackInput(code)
    if (state && ctx.state && state !== ctx.state) {
      throw new Error('[meow] State không khớp — hãy mở lại đăng nhập và dán code của lần này')
    }
    const tokens = await exchangeCode(ctx, cleanCode)
    let profile: Record<string, unknown> | null = null
    try {
      profile = await fetchProfile(tokens.accessToken)
    } catch {
      // Profile is best-effort; the account still works without it.
    }
    const accountProfile = profile ? profileToAccountProfile(profile) : undefined
    const id = randomUUID()
    const account: ProviderAccount = {
      id,
      provider: 'claude',
      name: accountProfile?.email ?? 'Claude account',
      authMode: 'oauth',
      active: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      profile: accountProfile,
      claudeConfigDir: claudeConfigDir(ctx.dir, id)
    }
    ctx.store.setTokens(id, tokens)
    const quota = profile ? parseClaudeQuota(profile, Date.now()) : null
    if (quota) account.quota = quota
    writeClaudeCredentials(account.claudeConfigDir!, ctx.store.getSecrets(id), accountProfile)
    return account
  },

  async onSwitch(account: ProviderAccount, ctx: AdapterContext): Promise<void> {
    const secrets = ctx.store.getSecrets(account.id)
    if (account.claudeConfigDir) {
      writeClaudeCredentials(account.claudeConfigDir, secrets, account.profile)
    }
  },

  buildSpawnEnv(account, secrets): Record<string, string> {
    return buildSpawnEnvFromSecrets(account, secrets)
  },

  async refreshQuota(account, secrets): Promise<QuotaInfo | null> {
    const tokens = secrets.tokens
    if (!tokens?.accessToken || !account.claudeConfigDir) return null
    let current = tokens
    // Refresh token if close to expiry, then persist.
    if (current.expiresAt - Date.now() < EXPIRY_SKEW_MS) {
      const refreshed = await refreshTokens(current)
      if (refreshed !== current) {
        current = refreshed
        secrets.tokens = current
      }
    }
    const profile = await fetchProfile(current.accessToken)
    const quota = parseClaudeQuota(profile, Date.now())
    if (account.claudeConfigDir) {
      writeClaudeCredentials(account.claudeConfigDir, secrets, account.profile)
    }
    return quota
  },

  async importFromJson(json: string, ctx: AdapterContext): Promise<ProviderAccount> {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const credentials = (parsed['credentials'] ?? parsed) as Record<string, unknown>
    const oauth = (credentials['claudeAiOauth'] ?? credentials['oauthAccount']) as Record<string, unknown> | undefined
    const accessToken = oauth ? readString(oauth, ['accessToken', 'access_token']) : undefined
    const tokens: ConnectionSecrets['tokens'] | undefined = oauth && accessToken
      ? {
          accessToken,
          refreshToken: readString(oauth, ['refreshToken', 'refresh_token']),
          idToken: readString(oauth, ['idToken', 'id_token']),
          expiresAt: Date.now() + 3600 * 1000,
          lastRefresh: Date.now()
        }
      : undefined
    const email = readString(oauth, ['email', 'emailAddress'])
      ?? readString(parsed, ['email'])
      ?? (typeof parsed['name'] === 'string' ? parsed['name'] : undefined)
    if (!tokens && !(typeof parsed['apiKey'] === 'string')) {
      throw new Error('[meow] JSON không chứa credentials hợp lệ (thiếu claudeAiOauth/oauthAccount hoặc apiKey)')
    }
    const id = randomUUID()
    const account: ProviderAccount = {
      id,
      provider: 'claude',
      name: email ?? 'Imported Claude',
      authMode: tokens?.accessToken ? 'oauth' : 'api-key',
      active: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      claudeConfigDir: claudeConfigDir(ctx.dir, id)
    }
    if (tokens) {
      ctx.store.setTokens(id, tokens)
      writeClaudeCredentials(account.claudeConfigDir!, ctx.store.getSecrets(id), undefined)
    } else if (typeof parsed['apiKey'] === 'string') {
      ctx.store.setApiKey(id, parsed['apiKey'] as string)
      if (typeof parsed['apiBaseUrl'] === 'string') account.apiBaseUrl = parsed['apiBaseUrl'] as string
      if (typeof parsed['apiKeyField'] === 'string') account.apiKeyField = parsed['apiKeyField'] as string
    }
    return account
  }
}
