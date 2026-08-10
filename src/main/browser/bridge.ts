import { createServer, type Server } from 'node:http'
import { randomInt, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  BrowserCommandName, BrowserCommandResult, BrowserEvent, BrowserStatus, BrowserStatusInfo,
  ExtensionToBridge, PairingInfo
} from '../../shared/browser-types'
import type { SnapshotNode } from '../../shared/browser-types'
import { snapshotToText, countSnapshotNodes } from './snapshot-format'

export interface BridgeDeps {
  host?: string
  preferredPort?: number
  screenshotDir?: string
  snapshotDir?: string
  codeTtlMs?: number
  maxLogEntries?: number
  createServer?: () => Server
}

interface PendingCommand {
  resolve: (r: BrowserCommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3927
const DEFAULT_CODE_TTL_MS = 5 * 60_000
const DEFAULT_MAX_LOG = 200
const DEFAULT_TIMEOUT_MS = 30_000

export class BrowserBridge {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private status: BrowserStatus = 'idle'
  private port = 0
  private code = ''
  private codeExpiresAt = 0
  private sessionPaired = false
  private pending = new Map<string, PendingCommand>()
  private consoleLogs: unknown[] = []
  private networkLogs: unknown[] = []
  private statusListeners = new Set<(info: BrowserStatusInfo) => void>()

  constructor(private deps: BridgeDeps = {}) {}

  getStatus(): BrowserStatusInfo {
    const paired = this.status === 'paired'
    return {
      status: this.status,
      port: this.port,
      paired,
      ...(paired ? {} : { pairingCode: this.code, pairingExpiresAt: this.codeExpiresAt || undefined })
    }
  }

  pair(): PairingInfo {
    this.code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    this.codeExpiresAt = Date.now() + (this.deps.codeTtlMs ?? DEFAULT_CODE_TTL_MS)
    this.sessionPaired = false
    this.setStatus(this.socket ? 'listening' : 'idle')
    return { code: this.code, expiresAt: this.codeExpiresAt }
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    this.code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    this.codeExpiresAt = Date.now() + (this.deps.codeTtlMs ?? DEFAULT_CODE_TTL_MS)
    this.sessionPaired = false
    const host = this.deps.host ?? DEFAULT_HOST
    const preferred = this.deps.preferredPort ?? DEFAULT_PORT

    const server = (this.deps.createServer ?? createServer)()
    server.on('request', (req, res) => {
      if (req.url?.startsWith('/api/status')) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*'
        })
        res.end(JSON.stringify({ port: this.port, status: this.status }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(preferred, host)
    })

    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
    this.server = server
    this.wss = new WebSocketServer({ server })
    this.wss.on('connection', (ws) => this.handleConnection(ws))
    this.setStatus('listening')
    return this.port
  }

  execute(
    name: BrowserCommandName,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<BrowserCommandResult> {
    if (this.status !== 'paired' || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: 'browser not connected — run browser_start first' })
    }
    const id = randomUUID()
    return new Promise<BrowserCommandResult>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: `browser command timed out: ${name}` })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.socket!.send(JSON.stringify({ type: 'cmd', id, name, params }))
    })
  }

  waitForPaired(timeoutMs: number): Promise<boolean> {
    if (this.status === 'paired') return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, timeoutMs)
      const off = this.onStatusChange(info => {
        if (info.status === 'paired') {
          clearTimeout(timer)
          off()
          resolve(true)
        }
      })
    })
  }

  getConsoleLogs(limit?: number): unknown[] {
    return sliceTail(this.consoleLogs, limit ?? DEFAULT_MAX_LOG)
  }

  getNetworkLogs(limit?: number): unknown[] {
    return sliceTail(this.networkLogs, limit ?? DEFAULT_MAX_LOG)
  }

  onStatusChange(cb: (info: BrowserStatusInfo) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  async close(): Promise<void> {
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer)
      resolve({ ok: false, error: 'browser bridge closed' })
    }
    this.pending.clear()
    this.socket?.close()
    this.socket = null
    await new Promise<void>(resolve => {
      if (!this.wss) { resolve(); return }
      this.wss.close(() => resolve())
    })
    this.wss = null
    await new Promise<void>(resolve => {
      if (!this.server) { resolve(); return }
      this.server.close(() => resolve())
    })
    this.server = null
    this.sessionPaired = false
    this.setStatus('idle')
  }

  private handleConnection(ws: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close()
    }
    this.socket = ws
    this.setStatus(this.code && Date.now() < this.codeExpiresAt ? 'listening' : 'idle')

    ws.on('message', (raw) => {
      let msg: ExtensionToBridge
      try {
        msg = JSON.parse(String(raw)) as ExtensionToBridge
      } catch {
        return
      }
      if (msg.type === 'pair') this.handlePair(ws, msg.code)
      else if (msg.type === 'result') this.handleResult(msg.id, msg)
      else if (msg.type === 'event') this.handleEvent(msg.name, msg.data)
    })

    ws.on('close', () => {
      if (this.socket === ws) {
        this.socket = null
        this.setStatus(this.code ? 'disconnected' : 'idle')
      }
    })
    ws.on('error', () => ws.close())
  }

  private handlePair(ws: WebSocket, code: string): void {
    // Code-entry TTL only bounds the initial pairing; once paired the extension stays
    // trusted for the app session so a reconnect can silently re-pair (MV3 SW suspension
    // can drop the WS while idle).
    const valid = code === this.code && (Date.now() < this.codeExpiresAt || this.sessionPaired)
    if (ws !== this.socket) return
    if (!valid) {
      ws.send(JSON.stringify({ type: 'pair_result', ok: false, error: 'invalid pairing code' }))
      return
    }
    this.sessionPaired = true
    this.setStatus('paired')
    ws.send(JSON.stringify({ type: 'pair_result', ok: true }))
  }

  private handleResult(id: string, msg: ExtensionToBridge & { type: 'result' }): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (msg.ok) {
      const data = msg.data as Record<string, unknown> | undefined
      const hasBase64 = !!data && typeof data === 'object' && 'base64' in data
      if (hasBase64 && this.deps.screenshotDir) {
        pending.resolve(this.saveScreenshot((data as { base64: string }).base64))
        return
      }
      const tree = data?.tree as SnapshotNode[] | undefined
      if (Array.isArray(tree) && this.deps.snapshotDir) {
        pending.resolve(this.saveSnapshot(tree))
        return
      }
      pending.resolve({ ok: true, data: msg.data })
    } else {
      pending.resolve({ ok: false, error: msg.error ?? 'browser command failed' })
    }
  }

  private saveSnapshot(tree: SnapshotNode[]): BrowserCommandResult {
    try {
      const dir = this.deps.snapshotDir!
      mkdirSync(dir, { recursive: true })
      const text = snapshotToText(tree)
      const file = path.join(dir, `browser-snapshot-${Date.now()}.txt`)
      writeFileSync(file, text, 'utf-8')
      const lines = text.split('\n')
      const preview = lines.slice(0, 80).join('\n') + (lines.length > 80 ? '\n...(preview cut — read the file for the full snapshot)' : '')
      return {
        ok: true,
        data: {
          path: file,
          size: Buffer.byteLength(text, 'utf-8'),
          nodeCount: countSnapshotNodes(tree),
          preview
        }
      }
    } catch (err) {
      return { ok: false, error: `snapshot save failed: ${String(err)}` }
    }
  }

  private saveScreenshot(base64: string): BrowserCommandResult {
    try {
      const dir = this.deps.screenshotDir!
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `browser-${Date.now()}.png`)
      writeFileSync(file, Buffer.from(base64, 'base64'))
      return { ok: true, data: { path: file } }
    } catch (err) {
      return { ok: false, error: `screenshot save failed: ${String(err)}` }
    }
  }

  private handleEvent(name: BrowserEvent['name'], data: unknown): void {
    if (name === 'console') {
      this.consoleLogs.push({ ...(data as object), ts: Date.now() })
      this.consoleLogs = sliceTail(this.consoleLogs, this.deps.maxLogEntries ?? DEFAULT_MAX_LOG)
    } else if (name === 'network') {
      this.networkLogs.push({ ...(data as object), ts: Date.now() })
      this.networkLogs = sliceTail(this.networkLogs, this.deps.maxLogEntries ?? DEFAULT_MAX_LOG)
    }
  }

  private setStatus(status: BrowserStatus): void {
    if (this.status === status) return
    this.status = status
    const info = this.getStatus()
    for (const cb of this.statusListeners) cb(info)
  }
}

function sliceTail<T>(arr: T[], limit: number): T[] {
  return arr.length > limit ? arr.slice(arr.length - limit) : [...arr]
}
