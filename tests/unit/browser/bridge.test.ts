import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { BrowserBridge } from '../../../src/main/browser/bridge'
import type { BridgeToExtension } from '../../../src/shared/browser-types'

const bridges: BrowserBridge[] = []
const dirs: string[] = []

function newBridge(deps: Record<string, unknown> = {}): BrowserBridge {
  const b = new BrowserBridge({ preferredPort: 0, ...deps })
  bridges.push(b)
  return b
}

function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-bridge-'))
  dirs.push(d)
  return d
}

afterEach(async () => {
  for (const b of bridges.splice(0)) await b.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMsg(ws: WebSocket): Promise<BridgeToExtension> {
  return new Promise(resolve => ws.once('message', raw => resolve(JSON.parse(String(raw)) as BridgeToExtension)))
}

describe('BrowserBridge', () => {
  it('starts on an ephemeral port and reports it via /api/status', async () => {
    const b = newBridge()
    const port = await b.start()
    expect(port).toBeGreaterThan(0)
    expect(b.getStatus().port).toBe(port)

    const res = await fetch(`http://127.0.0.1:${port}/api/status`)
    expect(res.ok).toBe(true)
    const body = await res.json() as { port: number; status: string }
    expect(body.port).toBe(port)
  })

  it('pairs with the correct code and rejects a wrong one', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code: '000000' }))
    const bad = await nextMsg(ws)
    expect(bad).toMatchObject({ type: 'pair_result', ok: false })

    ws.send(JSON.stringify({ type: 'pair', code }))
    const good = await nextMsg(ws)
    expect(good).toMatchObject({ type: 'pair_result', ok: true })
    expect(b.getStatus().status).toBe('paired')
    expect(b.getStatus().paired).toBe(true)
  })

  it('rejects execute when not paired', async () => {
    const b = newBridge()
    await b.start()
    const r = await b.execute('listTabs')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not connected')
  })

  it('routes a command to the extension and resolves the result', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('listTabs')
    const cmd = await nextMsg(ws) as Extract<BridgeToExtension, { type: 'cmd' }>
    expect(cmd).toMatchObject({ type: 'cmd', name: 'listTabs' })

    ws.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { tabs: [{ id: 1 }] } }))
    const r = await done
    expect(r).toEqual({ ok: true, data: { tabs: [{ id: 1 }] } })
  })

  it('times out when the extension never replies', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('read', undefined, 100)
    await nextMsg(ws) // consume cmd, don't reply
    const r = await done
    expect(r.ok).toBe(false)
    expect(r.error).toContain('timed out')
  })

  it('buffers console and network events in ring buffers', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'event', name: 'console', data: { level: 'log', text: `msg ${i}` } }))
      ws.send(JSON.stringify({ type: 'event', name: 'network', data: { method: 'GET', url: `u${i}` } }))
    }
    await new Promise(r => setTimeout(r, 50))

    expect(b.getConsoleLogs(3)).toHaveLength(3)
    expect(b.getConsoleLogs(3)[2]).toMatchObject({ text: 'msg 4' })
    expect(b.getNetworkLogs()).toHaveLength(5)
  })

  it('saves screenshots to the screenshot dir and returns the path', async () => {
    const dir = tmpDir()
    const b = newBridge({ screenshotDir: dir })
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('screenshot')
    const cmd = await nextMsg(ws) as Extract<BridgeToExtension, { type: 'cmd' }>
    ws.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { base64: Buffer.from('pngdata').toString('base64') } }))
    const r = await done
    expect(r.ok).toBe(true)
    const data = r.data as { path: string }
    expect(data.path).toMatch(/\.png$/)
    expect(data.path.startsWith(dir)).toBe(true)
  })

  it('waitForPaired resolves once paired and rejects on timeout', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    const waiter = b.waitForPaired(2000)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
    expect(await waiter).toBe(true)

    const b2 = newBridge()
    await b2.start()
    expect(await b2.waitForPaired(100)).toBe(false)
  })

  it('notifies status listeners on pair', async () => {
    const b = newBridge()
    const port = await b.start()
    const seen: string[] = []
    const off = b.onStatusChange(info => seen.push(info.status))
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
    expect(seen).toContain('paired')
    off()
  })
})
