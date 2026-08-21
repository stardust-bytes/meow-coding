import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

// PKCE (RFC 7636) helpers + a local OAuth callback server used by the Codex
// adapter (redirect_uri is localhost, so we can capture the code ourselves).
// Claude uses the same PKCE but a remote redirect_uri (platform.claude.com),
// so its code is pasted manually instead.

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function generatePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return randomBytes(24).toString('base64url')
}

// Decode the payload of a JWT without verifying the signature. Used to read
// email / account_id claims from OAuth id_token responses.
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8')
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export interface CallbackServer {
  port: number
  /** Resolves with the query params of the first matching /auth/callback request. */
  waitForCallback(timeoutMs?: number): Promise<Record<string, string>>
  close(): void
}

export interface StartCallbackServerOptions {
  preferredPort: number
  expectedState?: string
}

// Starts an HTTP server on 127.0.0.1:preferredPort. Responds to GET
// /auth/callback with a small success page and resolves waitForCallback() with
// the parsed query params. Rejects with EADDRINUSE if the port is busy — the
// Codex adapter maps that to CODEX_OAUTH_PORT_IN_USE.
export async function startCallbackServer(opts: StartCallbackServerOptions): Promise<CallbackServer> {
  const waiters: Array<(params: Record<string, string>) => void> = []
  // The browser callback typically arrives BEFORE the renderer asks for it
  // (user finishes login, then clicks a button). Cache the last valid callback
  // so a late waitForCallback() resolves immediately instead of hanging.
  let lastCallback: Record<string, string> | null = null
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.preferredPort}`)
    if (url.pathname === '/auth/callback') {
      const params: Record<string, string> = {}
      url.searchParams.forEach((value, key) => { params[key] = value })
      const expected = opts.expectedState
      if (expected && params.state !== expected) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<h1>State mismatch — close this tab and retry in the app.</h1>')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>✅ Authorized — you can close this tab and return to the app.</h1></body></html>')
      lastCallback = params
      const w = waiters.splice(0)
      for (const resolve of w) resolve(params)
      return
    }
    res.writeHead(404)
    res.end('Not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.preferredPort, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as AddressInfo

  return {
    port: addr.port,
    waitForCallback(timeoutMs = 5 * 60 * 1000): Promise<Record<string, string>> {
      if (lastCallback) return Promise.resolve(lastCallback)
      return new Promise((resolve, reject) => {
        const waiter = (params: Record<string, string>) => {
          clearTimeout(timer)
          resolve(params)
        }
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(waiter)
          if (idx >= 0) waiters.splice(idx, 1)
          reject(new Error(`[meow] Chờ OAuth callback quá thời gian (${Math.round(timeoutMs / 1000)}s)`))
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
    close() {
      server.close()
    }
  }
}
