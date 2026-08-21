import { describe, expect, it } from 'vitest'
import { generateCodeVerifier, generatePkceChallenge, decodeJwtPayload, startCallbackServer } from '../../src/main/connections/oauth'
import { parseClaudeQuota, parseOauthCallbackInput } from '../../src/main/connections/providers/claude'
import { getCodexAuthJsonPath, writeCodexAuthFile, restoreCodexAuthFile } from '../../src/main/connections/providers/codex'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProviderAccount } from '../../src/shared/types'
import type { ConnectionSecrets } from '../../src/main/connections/types'

describe('OAuth helpers', () => {
  it('generates a valid PKCE verifier (43-128 chars, base64url charset)', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(/^[A-Za-z0-9\-._~]+$/.test(verifier)).toBe(true)
  })

  it('PKCE challenge is deterministic S256 of the verifier', () => {
    const v1 = generateCodeVerifier()
    expect(generatePkceChallenge(v1)).toBe(generatePkceChallenge(v1))
    const v2 = generateCodeVerifier()
    if (v1 !== v2) expect(generatePkceChallenge(v1)).not.toBe(generatePkceChallenge(v2))
  })

  it('decodes a JWT payload without verification', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ email: 'a@b.c', aud: 'x' })).toString('base64url')
    const token = `${header}.${payload}.sig`
    expect(decodeJwtPayload<{ email?: string }>(token)?.email).toBe('a@b.c')
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
  })
})

describe('callback server', () => {
  it('captures a /auth/callback request and validates state', async () => {
    const server = await startCallbackServer({ preferredPort: 0, expectedState: 'abc' })
    const wait = server.waitForCallback(5000)
    // Simulate the browser hitting the redirect URI.
    const res = await fetch(`http://127.0.0.1:${server.port}/auth/callback?code=CODE123&state=abc`)
    expect(res.status).toBe(200)
    const params = await wait
    expect(params).toMatchObject({ code: 'CODE123', state: 'abc' })
    server.close()
  })

  it('resolves a late waitForCallback from the cached callback', async () => {
    // Regression: browser callback arrives BEFORE the renderer asks for it.
    const server = await startCallbackServer({ preferredPort: 0, expectedState: 'abc' })
    const res = await fetch(`http://127.0.0.1:${server.port}/auth/callback?code=EARLY&state=abc`)
    expect(res.status).toBe(200)
    const params = await server.waitForCallback(5000)
    expect(params).toMatchObject({ code: 'EARLY', state: 'abc' })
    server.close()
  })

  it('rejects a callback with a mismatched state', async () => {
    const server = await startCallbackServer({ preferredPort: 0, expectedState: 'abc' })
    const res = await fetch(`http://127.0.0.1:${server.port}/auth/callback?code=X&state=WRONG`)
    expect(res.status).toBe(400)
    server.close()
  })

  it('rejects when the preferred port is already in use', async () => {
    const { createServer } = await import('node:http')
    const blocker = createServer(() => {})
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
    const busyPort = (blocker.address() as { port: number }).port
    await expect(startCallbackServer({ preferredPort: busyPort, expectedState: 'abc' })).rejects.toThrow(/EADDRINUSE/)
    blocker.close()
  })
})

describe('parseClaudeQuota', () => {
  it('parses plan + usage from the oauth/profile response', () => {
    const profile = {
      endpoints: {
        organizationUsage: {
          five_hour: { utilization: 42 },
          seven_day: { utilization: 78 }
        },
        subscriptionDetails: { plan_type: 'claude_pro' }
      }
    }
    const quota = parseClaudeQuota(profile, 1234)
    expect(quota?.planType).toBe('claude_pro')
    expect(quota?.used).toBe(42)
    expect(quota?.limit).toBe(100)
    expect(quota?.refreshedAt).toBe(1234)
  })

  it('returns null when no usage data is present', () => {
    expect(parseClaudeQuota({}, 0)).toBeNull()
  })
})

describe('codex auth.json merge', () => {
  let dir: string
  const account: ProviderAccount = {
    id: 'acc-1', provider: 'codex', name: 'x', authMode: 'oauth', active: true,
    createdAt: 1, lastUsed: 1, codexAuthMode: 'oauth'
  }
  const secrets: ConnectionSecrets = {
    tokens: {
      accessToken: 'at-1', refreshToken: 'rt-1', idToken: 'id-1', expiresAt: Date.now() + 1e6, lastRefresh: Date.now()
    }
  }

  const withHome = async (fn: () => void) => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-codex-'))
    const origHome = process.env.HOME
    process.env.HOME = dir
    // homedir() reads HOME on POSIX; on Windows it reads USERPROFILE.
    const origUserProfile = process.env.USERPROFILE
    process.env.USERPROFILE = dir
    try {
      fn()
    } finally {
      if (origHome === undefined) delete process.env.HOME
      else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = origUserProfile
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('writes an oauth-shaped auth.json and preserves unknown keys', () => withHome(() => {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs")
    mkdirSync(path.join(dir, '.codex'), { recursive: true })
    writeFileSync(path.join(dir, '.codex', 'auth.json'), JSON.stringify({ some_unknown: 'keep' }))
    writeCodexAuthFile(account, secrets)
    const parsed = JSON.parse(readFileSync(getCodexAuthJsonPath(), 'utf-8'))
    expect(parsed).toMatchObject({
      auth_mode: 'oauth',
      OPENAI_API_KEY: null,
      some_unknown: 'keep',
      tokens: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'id-1' }
    })
  }))

  it('writes an apikey-shaped auth.json', () => withHome(() => {
    writeCodexAuthFile({ ...account, codexAuthMode: 'apikey' }, { apiKey: 'sk-123' })
    const parsed = JSON.parse(readFileSync(getCodexAuthJsonPath(), 'utf-8'))
    expect(parsed).toMatchObject({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-123' })
  }))

  it('backs up the original file on first write and restores it', () => withHome(() => {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs")
    mkdirSync(path.join(dir, '.codex'), { recursive: true })
    writeFileSync(path.join(dir, '.codex', 'auth.json'), JSON.stringify({ original: true }))
    writeCodexAuthFile(account, secrets)
    expect(existsSync(path.join(dir, '.codex', 'auth.json.meow-backup'))).toBe(true)
    restoreCodexAuthFile()
    expect(JSON.parse(readFileSync(getCodexAuthJsonPath(), 'utf-8'))).toEqual({ original: true })
  }))
})

describe('parseOauthCallbackInput', () => {
  it('accepts a raw code', () => {
    expect(parseOauthCallbackInput('abc123')).toEqual({ code: 'abc123' })
  })

  it('accepts a full callback URL and extracts code + state', () => {
    const input = 'https://platform.claude.com/oauth/code/callback?code=XYZ&state=st1'
    expect(parseOauthCallbackInput(input)).toEqual({ code: 'XYZ', state: 'st1' })
  })

  it('accepts a query-like string', () => {
    expect(parseOauthCallbackInput('code=Q1&state=st2')).toEqual({ code: 'Q1', state: 'st2' })
  })

  it('cleans #fragment and & suffixes from a raw code', () => {
    // Fragment keeps the raw suffix (mirrors cockpit clean_authorization_code).
    expect(parseOauthCallbackInput('CODE#state=st')).toEqual({ code: 'CODE', state: 'state=st' })
    expect(parseOauthCallbackInput('CODE&state=st')).toEqual({ code: 'CODE' })
  })

  it('rejects an authorize URL with a clear error', () => {
    expect(() =>
      parseOauthCallbackInput('https://claude.com/cai/oauth/authorize?client_id=x&code=true')
    ).toThrow(/authorize/)
  })

  it('rejects a URL without a code param', () => {
    expect(() => parseOauthCallbackInput('https://platform.claude.com/oauth/code/callback')).toThrow(/code/)
  })

  it('rejects empty input', () => {
    expect(() => parseOauthCallbackInput('   ')).toThrow(/dán/)
  })
})
