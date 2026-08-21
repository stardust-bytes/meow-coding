import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GatewayConfig, GatewayRequestLog, ProviderAccount } from '../../shared/types'
import type { ConnectionSecrets } from '../connections/types'
import { selectAccount, blockAccount, unblockAccount, type AccountHealth } from './router'
import { forwardChatCompletions, forwardListModels } from './forward'
import type { GatewayLogStore } from './log-store'

export interface GatewayServerDeps {
  getConfig(): GatewayConfig
  getAccounts(): ProviderAccount[]
  getSecrets(id: string): ConnectionSecrets
  health: Map<string, AccountHealth>
  logs: GatewayLogStore
}

export interface GatewayServerHandle {
  port: number
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

// Local OpenAI-compatible gateway. Binds 127.0.0.1 only; requires the
// user-configured gateway apiKey as Bearer.
export async function startGatewayServer(deps: GatewayServerDeps, preferredPort: number): Promise<GatewayServerHandle> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now()
    const method = req.method ?? ''
    const path = req.url ?? ''
    const writeLog = (partial: { status: number; accountId?: string | null; model?: string | null; tokensIn?: number; tokensOut?: number; error?: string }): void => {
      deps.logs.append({
        method,
        path,
        accountId: partial.accountId ?? null,
        model: partial.model ?? null,
        status: partial.status,
        durationMs: Date.now() - started,
        tokensIn: partial.tokensIn ?? 0,
        tokensOut: partial.tokensOut ?? 0,
        ...(partial.error ? { error: partial.error } : {})
      })
    }
    const respond = (status: number, body: object, extra?: { accountId?: string | null; model?: string | null; error?: string }): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
      writeLog({ status, ...extra })
    }

    try {
      const cfg = deps.getConfig()
      if (!cfg.enabled) {
        respond(503, { error: { message: '[meow] Gateway đang tắt', type: 'gateway_disabled' } })
        return
      }
      const auth = req.headers.authorization ?? ''
      const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
      if (!cfg.apiKey || provided !== cfg.apiKey) {
        respond(401, { error: { message: '[meow] Gateway API key không đúng', type: 'invalid_api_key' } })
        return
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${preferredPort}`)

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const accounts = deps.getAccounts()
        const result = await forwardListModels(accounts.map(account => ({ account, secrets: deps.getSecrets(account.id) })))
        res.writeHead(result.status, { 'content-type': 'application/json' })
        res.end(result.body)
        writeLog({ status: result.status })
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readBody(req)
        let parsedBody: { model?: string }
        try {
          parsedBody = JSON.parse(body) as { model?: string }
        } catch {
          respond(400, { error: { message: '[meow] Body không phải JSON hợp lệ', type: 'invalid_request' } })
          return
        }

        const account = selectAccount(deps.getAccounts(), deps.getSecrets, deps.health, {
          strategy: cfg.routingStrategy,
          coldownSeconds: cfg.coldownSeconds,
          quotaReservePercent: cfg.quotaReservePercent,
          activeAccountId: deps.getAccounts().find(a => a.active)?.id ?? null
        })

        if (!account) {
          respond(429, { error: { message: '[meow] Không có account khả dụng (tất cả bị block hoặc hết quota)', type: 'no_available_account' } })
          return
        }

        const secrets = deps.getSecrets(account.id)
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const result = await forwardChatCompletions(account, secrets, body, controller.signal)

        if (result.status >= 400) {
          blockAccount(deps.health, account.id, cfg.coldownSeconds, result.error)
        } else {
          unblockAccount(deps.health, account.id)
        }

        if (result.stream) {
          res.writeHead(result.status, result.headers)
          const reader = result.stream.getReader()
          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read()
            if (done) {
              res.end()
              writeLog({ status: result.status, accountId: account.id, model: parsedBody.model ?? null })
              return
            }
            res.write(Buffer.from(value))
            void pump()
          }
          void pump()
          return
        }

        res.writeHead(result.status, result.headers)
        res.end(result.body ?? Buffer.alloc(0))
        writeLog({
          status: result.status,
          accountId: account.id,
          model: parsedBody.model ?? null,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          ...(result.error ? { error: result.error } : {})
        })
        return
      }

      respond(404, { error: { message: 'Not found', type: 'not_found' } })
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `[meow] Gateway lỗi: ${String(err)}`, type: 'gateway_error' } }))
      }
      writeLog({ status: 500, error: String(err) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(preferredPort, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as AddressInfo

  return {
    port: addr.port,
    close(): Promise<void> {
      return new Promise(resolve => server.close(() => resolve()))
    }
  }
}
