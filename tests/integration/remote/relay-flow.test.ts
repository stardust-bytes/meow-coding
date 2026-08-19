import { describe, expect, it, afterEach } from 'vitest'
import WebSocket from 'ws'
import { createRelayServer } from '../../../server/index'
import { RemoteRelayClient } from '../../../src/main/remote/remote-relay-client'
import { RemotePairing } from '../../../src/main/remote/remote-pairing'
import type { RelayClientDeps, RelayStatus } from '../../../src/main/remote/remote-relay-client'
import type { RemoteEnvelope } from '../../../src/shared/remote-types'

interface FakeMobile {
  ws: WebSocket
  token?: string
  pair: { ok: boolean; error?: string }
  recv: unknown[]
  close(): Promise<void>
}

const clients: RemoteRelayClient[] = []
const relays: (() => Promise<void>)[] = []
const mobiles: FakeMobile[] = []

afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  for (const m of mobiles.splice(0)) await m.close()
  for (const r of relays.splice(0)) await r()
})

async function startRelay() {
  const relay = await createRelayServer({ port: 0 })
  relays.push(() => relay.close())
  return relay
}

function newClient(overrides: Partial<RelayClientDeps> & { url: string; deviceId: string }): RemoteRelayClient {
  const client = new RemoteRelayClient({
    pairing: new RemotePairing(),
    dispatch: async (name) =>
      name === 'workspace:list'
        ? { ok: true, result: [{ id: 'w1' }] }
        : { ok: false, error: `unhandled: ${name}` },
    ...overrides
  })
  clients.push(client)
  return client
}

function waitForStatus(client: RemoteRelayClient, pred: (s: RelayStatus) => boolean, timeoutMs = 3000): Promise<RelayStatus> {
  if (pred(client.status)) return Promise.resolve(client.status)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('status condition not met'))
    }, timeoutMs)
    const off = client.onStatusChange((s) => {
      if (pred(s)) {
        clearTimeout(timer)
        off()
        resolve(s)
      }
    })
  })
}

function waitForMsg(ws: WebSocket, pred: (m: RemoteEnvelope) => boolean, timeoutMs = 3000): Promise<RemoteEnvelope> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: WebSocket.RawData) => {
      let m: RemoteEnvelope
      try {
        m = JSON.parse(String(raw)) as RemoteEnvelope
      } catch {
        return
      }
      if (pred(m)) {
        cleanup()
        resolve(m)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for ws message'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      ws.off('message', onMsg)
    }
    ws.on('message', onMsg)
  })
}

async function fakeMobile(port: number, auth: string): Promise<FakeMobile> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'hello', role: 'mobile', deviceId: 'phone-1', auth }))
  const pair = await waitForMsg(ws, (m) => m.type === 'pair-result')
  const recv: unknown[] = []
  ws.on('message', (raw) => recv.push(JSON.parse(String(raw))))
  const mobile: FakeMobile = {
    ws,
    pair: { ok: pair.ok ?? false, error: pair.error },
    token: pair.token,
    recv,
    close: () => new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      ws.once('close', () => resolve())
      ws.close()
    })
  }
  mobiles.push(mobile)
  return mobile
}

describe('RemoteRelayClient relay flow', () => {
  it('pairs via a pairing code and runs a remote command', async () => {
    const { port } = await startRelay()
    const client = newClient({ url: `ws://127.0.0.1:${port}`, deviceId: 'desk-1' })
    const statuses: RelayStatus[] = []
    client.onStatusChange((s) => statuses.push(s))
    client.connect()
    await waitForStatus(client, (s) => s.connected)
    const { code } = client.startPairing()

    const mobile = await fakeMobile(port, code)
    expect(mobile.pair.ok).toBe(true)
    expect(mobile.token).toBeTruthy()
    expect(client.status.paired).toBe(true)
    expect(statuses.some((s) => s.connected && s.paired)).toBe(true)

    mobile.ws.send(JSON.stringify({ type: 'cmd', id: 'c1', cmd: 'workspace:list', params: {} }))
    const res = await waitForMsg(mobile.ws, (m) => m.type === 'cmd-result')
    expect(res).toMatchObject({ type: 'cmd-result', id: 'c1', ok: true, result: [{ id: 'w1' }] })
  })

  it('reuses an issued token on a second client', async () => {
    const { port } = await startRelay()
    const url = `ws://127.0.0.1:${port}`
    const pairing = new RemotePairing()

    const client1 = newClient({ url, deviceId: 'desk-1', pairing })
    client1.connect()
    await waitForStatus(client1, (s) => s.connected)
    const { code } = client1.startPairing()
    const mobile1 = await fakeMobile(port, code)
    const token = mobile1.token!
    expect(token).toBeTruthy()
    await mobile1.close()
    client1.close()

    const client2 = newClient({ url, deviceId: 'desk-1', pairing })
    client2.connect()
    await waitForStatus(client2, (s) => s.connected)
    const mobile2 = await fakeMobile(port, token)
    expect(mobile2.pair.ok).toBe(true)
    expect(mobile2.token).toBeTruthy()
    expect(client2.status.paired).toBe(true)
    await mobile2.close()
  })

  it('forwards events to a paired mobile', async () => {
    const { port } = await startRelay()
    const client = newClient({ url: `ws://127.0.0.1:${port}`, deviceId: 'desk-1' })
    client.connect()
    await waitForStatus(client, (s) => s.connected)
    const { code } = client.startPairing()
    const mobile = await fakeMobile(port, code)
    expect(client.status.paired).toBe(true)

    client.sendEvent({ type: 'agent:state', agentId: 'a1', running: true, background: false })
    const msg = await waitForMsg(mobile.ws, (m) => m.type === 'event')
    expect(msg).toMatchObject({
      type: 'event',
      event: { type: 'agent:state', agentId: 'a1', running: true, background: false }
    })
  })

  it('tells the mobile when the desktop goes offline', async () => {
    const { port } = await startRelay()
    const client = newClient({ url: `ws://127.0.0.1:${port}`, deviceId: 'desk-1' })
    client.connect()
    await waitForStatus(client, (s) => s.connected)
    const { code } = client.startPairing()
    const mobile = await fakeMobile(port, code)

    client.close()
    const msg = await waitForMsg(mobile.ws, (m) => m.type === 'desktop-status')
    expect(msg).toMatchObject({ type: 'desktop-status', online: false })
  })

  it('rejects a wrong pairing code', async () => {
    const { port } = await startRelay()
    const client = newClient({ url: `ws://127.0.0.1:${port}`, deviceId: 'desk-1' })
    client.connect()
    await waitForStatus(client, (s) => s.connected)
    const { code } = client.startPairing()

    const mobile = await fakeMobile(port, code === '000000' ? '000001' : '000000')
    expect(mobile.pair.ok).toBe(false)
    expect(mobile.token).toBeUndefined()
    expect(client.status.paired).toBe(false)
  })
})
