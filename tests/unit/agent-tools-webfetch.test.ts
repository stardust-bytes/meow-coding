import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { webfetchTool } from '../../src/main/agent/tools/webfetch'
import type { ToolContext } from '../../src/main/agent/tools/types'

let server: http.Server | null = null

function startServer(body: string, contentType = 'text/html'): Promise<number> {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      if (req.url === '/boom') {
        res.writeHead(500)
        res.end('nope')
        return
      }
      res.writeHead(200, { 'content-type': contentType })
      res.end(body)
    })
    server.listen(0, () => resolve((server!.address() as AddressInfo).port))
  })
}

afterEach(() => {
  server?.close()
  server = null
})

describe('webfetch tool', () => {
  it('converts an HTML page to markdown', async () => {
    const port = await startServer('<html><body><h1>Hello World</h1><p>Some <b>bold</b> text.</p></body></html>')
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await webfetchTool.run({ url: `http://127.0.0.1:${port}/page` }, ctx)
    expect(r.output).toContain('Hello World')
    expect(r.output).toContain('**bold**')
    expect(r.output).toContain('Some')
  })

  it('returns raw text for non-html content', async () => {
    const port = await startServer('plain body', 'text/plain')
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await webfetchTool.run({ url: `http://127.0.0.1:${port}/x` }, ctx)
    expect(r.output).toContain('plain body')
  })

  it('reports HTTP errors', async () => {
    const port = await startServer('nope')
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await webfetchTool.run({ url: `http://127.0.0.1:${port}/boom` }, ctx)
    expect(r.error).toMatch(/HTTP 500/)
  })

  it('rejects non-http urls', async () => {
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await webfetchTool.run({ url: 'file:///etc/passwd' }, ctx)
    expect(r.error).toMatch(/invalid url/)
  })

  it('truncates long output to maxChars', async () => {
    const port = await startServer('<html><body><p>' + 'a'.repeat(200) + '</p></body></html>', 'text/html')
    const ctx: ToolContext = { cwd: '/proj', ask: async () => null }
    const r = await webfetchTool.run({ url: `http://127.0.0.1:${port}/p`, maxChars: 50 }, ctx)
    expect(r.output!.length).toBeLessThan(80)
    expect(r.output).toContain('truncated')
  })
})
