import { describe, expect, it, afterEach } from 'vitest'
import WebSocket from 'ws'
import { BrowserBridge } from '../../../src/main/browser/bridge'
import type { BridgeToExtension } from '../../../src/shared/browser-types'

const bridges: BrowserBridge[] = []

function newBridge(): BrowserBridge {
  const b = new BrowserBridge({ preferredPort: 0 })
  bridges.push(b)
  return b
}

afterEach(async () => {
  for (const b of bridges.splice(0)) await b.close()
})

interface FakeExtension {
  ws: WebSocket
  close(): Promise<void>
}

// Mô phỏng extension: pair rồi tự trả lời từng command theo map name → result.
async function fakeExtension(port: number, code: string, handlers: Record<string, (params: Record<string, unknown>) => unknown>): Promise<FakeExtension> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'pair', code }))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error('pair timeout'))
    }, 2000)
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as BridgeToExtension
      if (msg.type === 'pair_result' && msg.ok) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve()
      }
    }
    ws.on('message', onMsg)
    ws.once('error', () => {
      clearTimeout(timer)
      reject(new Error('ws error'))
    })
  })
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as BridgeToExtension
    if (msg.type !== 'cmd') return
    const handler = handlers[msg.name]
    const data = handler ? handler(msg.params ?? {}) : { error: `no handler: ${msg.name}` }
    const out: { type: 'result'; id: string; ok: boolean } & Record<string, unknown> = {
      type: 'result', id: msg.id, ok: true, data
    }
    ws.send(JSON.stringify(out))
  })
  return {
    ws,
    close: () => new Promise<void>(resolve => {
      if (ws.readyState === WebSocket.CLOSED) { resolve(); return }
      ws.once('close', () => resolve())
      ws.close()
    })
  }
}

describe('BrowserBridge full flow (fake extension)', () => {
  it('executes navigate/read/screenshot through a paired extension and captures events', async () => {
    const b = newBridge()
    const port = await b.start()
    const { code } = b.pair()

    const ext = await fakeExtension(port, code, {
      navigate: (p) => ({ url: p.url, ok: true }),
      read: () => ({ url: 'https://example.com', title: 'Example', text: 'hello', elements: [] }),
      screenshot: () => ({ base64: Buffer.from('img').toString('base64') })
    })

    expect(b.getStatus().paired).toBe(true)

    const nav = await b.execute('navigate', { url: 'https://example.com' })
    expect(nav).toMatchObject({ ok: true, data: { url: 'https://example.com' } })

    const read = await b.execute('read')
    expect(read.ok).toBe(true)
    expect((read.data as { title: string }).title).toBe('Example')

    // screenshot không có screenshotDir → trả nguyên data chứa base64
    const shot = await b.execute('screenshot')
    expect(shot.ok).toBe(true)
    expect((shot.data as { base64: string }).base64.length).toBeGreaterThan(0)

    // event từ extension → ring buffer
    ext.ws.send(JSON.stringify({ type: 'event', name: 'console', data: { level: 'error', text: 'boom' } }))
    await new Promise(r => setTimeout(r, 50))
    expect(b.getConsoleLogs()).toHaveLength(1)
    expect(b.getConsoleLogs()[0]).toMatchObject({ text: 'boom' })

    await ext.close()
  })

  it('reconnects: pairing again after a close re-enables commands', async () => {
    const b = newBridge()
    const port = await b.start()
    const { code } = b.pair()

    const ext1 = await fakeExtension(port, code, { listTabs: () => ({ tabs: [1] }) })
    expect(b.getStatus().paired).toBe(true)
    await ext1.close()
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(false)

    const ext2 = await fakeExtension(port, code, { listTabs: () => ({ tabs: [2] }) })
    expect(b.getStatus().paired).toBe(true)
    const r = await b.execute('listTabs')
    expect(r).toMatchObject({ ok: true, data: { tabs: [2] } })
    await ext2.close()
  })
})
