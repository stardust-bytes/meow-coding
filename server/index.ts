import { WebSocketServer, WebSocket, type RawData } from 'ws'
import type {
  RemoteEnvelope,
  RemoteHello,
  RemotePairResult
} from '../src/shared/remote-types'

const log = (msg: string): void => console.log(`[relay] ${msg}`)

interface DesktopPeer {
  ws: WebSocket
  deviceId: string
  alive: boolean
}

interface MobilePeer {
  ws: WebSocket
  deviceId: string
  alive: boolean
  paired: boolean
}

interface PairingEntry {
  expiresAt: number
}

export interface RelayHandle {
  wss: WebSocketServer
  port: number
  close(): Promise<void>
}

const CODE_RE = /^\d{6}$/

export async function createRelayServer(options: { port?: number } = {}): Promise<RelayHandle> {
  let desktop: DesktopPeer | null = null
  let mobile: MobilePeer | null = null
  let pendingCode: string | null = null
  const pairingCode = new Map<string, PairingEntry>()

  const wss = new WebSocketServer({ host: '0.0.0.0', port: options.port ?? 0 })
  wss.on('error', (err) => log(`server error: ${err.message}`))

  const port = await new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => {
      wss.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      wss.removeListener('error', onError)
      const addr = wss.address()
      resolve(typeof addr === 'object' && addr ? addr.port : (options.port ?? 0))
    }
    wss.once('error', onError)
    wss.once('listening', onListening)
  })

  const send = (ws: WebSocket, msg: RemoteEnvelope): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const handleDisconnect = (ws: WebSocket): void => {
    if (desktop?.ws === ws) {
      desktop = null
      log('desktop disconnected')
      if (mobile) send(mobile.ws, { type: 'desktop-status', online: false })
    } else if (mobile?.ws === ws) {
      mobile = null
      log('mobile disconnected')
    }
  }

  const handleHello = (ws: WebSocket, msg: RemoteHello): void => {
    if (msg.role === 'desktop') {
      if (desktop && desktop.ws !== ws) desktop.ws.close()
      desktop = { ws, deviceId: msg.deviceId, alive: true }
      pendingCode = null
      log(`desktop connected: ${msg.deviceId}`)
      if (mobile) send(mobile.ws, { type: 'desktop-status', online: true })
      return
    }
    if (mobile && mobile.ws !== ws) mobile.ws.close()
    mobile = { ws, deviceId: msg.deviceId, alive: true, paired: false }
    log(`mobile connected: ${msg.deviceId}`)
    if (!desktop) {
      send(ws, { type: 'desktop-status', online: false })
      return
    }
    if (msg.auth && CODE_RE.test(msg.auth)) {
      const entry = pairingCode.get(msg.auth)
      if (entry && entry.expiresAt <= Date.now()) pairingCode.delete(msg.auth)
      pendingCode = msg.auth
    }
    send(desktop.ws, msg)
  }

  const handlePairResult = (ws: WebSocket, msg: RemotePairResult): void => {
    if (desktop?.ws !== ws) return
    if (mobile) {
      send(mobile.ws, msg)
      mobile.paired = msg.ok
    }
    if (msg.ok && pendingCode) pairingCode.delete(pendingCode)
    pendingCode = null
  }

  const handleMessage = (ws: WebSocket, raw: RawData): void => {
    let msg: RemoteEnvelope
    try {
      msg = JSON.parse(String(raw)) as RemoteEnvelope
    } catch {
      return
    }
    switch (msg.type) {
      case 'hello':
        handleHello(ws, msg)
        break
      case 'pairing-start':
        if (desktop?.ws === ws) {
          pairingCode.set(msg.code, { expiresAt: Date.now() + msg.ttlMs })
        }
        break
      case 'pair-result':
        handlePairResult(ws, msg)
        break
      case 'cmd':
        if (mobile?.ws === ws && mobile.paired && desktop) send(desktop.ws, msg)
        break
      case 'cmd-result':
        if (desktop?.ws === ws && mobile) send(mobile.ws, msg)
        break
      case 'event':
        if (desktop?.ws === ws && mobile?.paired) send(mobile.ws, msg)
        break
      case 'ping':
        send(ws, { type: 'pong' })
        break
      case 'pong':
      case 'desktop-status':
        break
    }
  }

  wss.on('connection', (ws) => {
    ws.on('pong', () => {
      if (desktop?.ws === ws) desktop.alive = true
      else if (mobile?.ws === ws) mobile.alive = true
    })
    ws.on('message', (raw) => handleMessage(ws, raw))
    ws.on('close', () => handleDisconnect(ws))
    ws.on('error', () => ws.close())
  })

  const heartbeat = setInterval(() => {
    for (const peer of [desktop, mobile]) {
      if (!peer) continue
      if (!peer.alive) {
        peer.ws.terminate()
        handleDisconnect(peer.ws)
        continue
      }
      peer.alive = false
      peer.ws.ping()
    }
  }, 30_000)

  return {
    wss,
    port,
    close: async () => {
      clearInterval(heartbeat)
      for (const ws of wss.clients) ws.close()
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
    }
  }
}

if (process.argv[1]?.endsWith('index.ts')) {
  const port = Number(process.env.PORT ?? 3928) || 3928
  createRelayServer({ port })
    .then((relay) => {
      log(`listening on 0.0.0.0:${relay.port}`)
      process.on('SIGINT', () => {
        log('shutting down')
        relay.close().then(() => process.exit(0))
      })
    })
    .catch((err: unknown) => {
      console.error('[relay] failed to start:', err)
      process.exit(1)
    })
}
