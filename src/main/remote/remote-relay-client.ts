import { WebSocket } from 'ws'
import type { RemotePairing } from './remote-pairing'
import type { RemoteCommandResult } from './remote-commands'
import type {
  RemoteCmd,
  RemoteCommandName,
  RemoteEnvelope,
  RemoteEvent,
  RemoteHello,
  RemotePairResult
} from '../../shared/remote-types'

export interface RelayClientDeps {
  url: string
  deviceId: string
  pairing: RemotePairing
  dispatch: (name: RemoteCommandName, params: Record<string, unknown>) => Promise<RemoteCommandResult>
  onPairOk?: (token: string) => void
  now?: () => number
  wsImpl?: new (url: string) => WebSocket
}

export interface RelayStatus {
  connected: boolean
  paired: boolean
  error?: string
}

const RECONNECT_BACKOFFS = [1_000, 2_000, 5_000, 10_000, 30_000]
const HEARTBEAT_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 10_000
const PAIRING_CODE_RE = /^\d{6}$/

export class RemoteRelayClient {
  private _status: RelayStatus = { connected: false, paired: false }
  private listeners = new Set<(s: RelayStatus) => void>()
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private backoffIndex = 0
  private closed = false

  constructor(private deps: RelayClientDeps) {}

  get status(): RelayStatus {
    return { ...this._status }
  }

  connect(): void {
    if (this.closed || this.ws) return
    const WsImpl = this.deps.wsImpl ?? WebSocket
    const ws = new WsImpl(this.deps.url)
    this.ws = ws
    ws.on('open', () => this.handleOpen(ws))
    ws.on('message', (raw) => this.handleMessage(ws, raw))
    ws.on('close', () => this.handleClose(ws))
    ws.on('error', (err) => this.handleError(ws, err))
  }

  sendEvent(e: RemoteEvent): void {
    if (!this._status.paired) return
    this.send({ type: 'event', event: e })
  }

  startPairing(): { code: string; expiresAt: number } {
    const p = this.deps.pairing.startPairing()
    this.send({ type: 'pairing-start', code: p.code, ttlMs: p.expiresAt - this.now() })
    return p
  }

  revokeToken(): void {
    this.deps.pairing.revokeToken()
    this.setStatus({ paired: false })
  }

  onStatusChange(cb: (s: RelayStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = null
    if (ws) ws.close()
    this.setStatus({ connected: false, paired: false })
  }

  private handleOpen(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.backoffIndex = 0
    this.setStatus({ connected: true, error: undefined })
    ws.send(JSON.stringify({ type: 'hello', role: 'desktop', deviceId: this.deps.deviceId }))
    this.startHeartbeat(ws)
  }

  private handleMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    if (this.ws !== ws) return
    let msg: RemoteEnvelope
    try {
      msg = JSON.parse(String(raw)) as RemoteEnvelope
    } catch {
      return
    }
    switch (msg.type) {
      case 'hello':
        this.handleHello(ws, msg)
        break
      case 'cmd':
        void this.handleCmd(ws, msg)
        break
      case 'ping':
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
        break
      default:
        break
    }
  }

  private handleHello(ws: WebSocket, msg: RemoteHello): void {
    if (this.ws !== ws || msg.role !== 'mobile' || !msg.auth) return
    const ok = PAIRING_CODE_RE.test(msg.auth)
      ? this.deps.pairing.validatePairingCode(msg.auth)
      : this.deps.pairing.validateToken(msg.auth)
    const res: RemotePairResult = ok
      ? { type: 'pair-result', ok: true, token: this.deps.pairing.issueToken() }
      : { type: 'pair-result', ok: false, error: 'invalid pairing code or token' }
    this.send(res)
    if (ok) {
      this.setStatus({ paired: true })
      if (res.token) this.deps.onPairOk?.(res.token)
    }
  }

  private async handleCmd(ws: WebSocket, msg: RemoteCmd): Promise<void> {
    if (this.ws !== ws) return
    let result: RemoteCommandResult
    try {
      result = await this.deps.dispatch(msg.cmd, msg.params)
    } catch (err) {
      result = { ok: false, error: String(err) }
    }
    this.send({ type: 'cmd-result', id: msg.id, ...result })
  }

  private handleClose(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.ws = null
    this.stopHeartbeat()
    this.setStatus({ connected: false, paired: false })
    if (!this.closed) this.scheduleReconnect()
  }

  private handleError(ws: WebSocket, err: Error): void {
    if (this.ws !== ws || this.closed) return
    this.setStatus({ error: err.message })
    ws.close()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_BACKOFFS[Math.min(this.backoffIndex, RECONNECT_BACKOFFS.length - 1)]
    this.backoffIndex++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closed) this.connect()
    }, delay)
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat()
    ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer)
        this.pongTimer = null
      }
    })
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.ping()
      this.pongTimer = setTimeout(() => ws.terminate(), PONG_TIMEOUT_MS)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private send(msg: RemoteEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private setStatus(patch: Partial<RelayStatus>): void {
    const next = { ...this._status, ...patch }
    if (
      next.connected === this._status.connected &&
      next.paired === this._status.paired &&
      next.error === this._status.error
    ) {
      return
    }
    this._status = next
    for (const cb of this.listeners) cb({ ...next })
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
