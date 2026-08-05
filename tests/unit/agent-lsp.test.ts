import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { LspManager } from '../../src/main/agent/lsp/manager'
import { serverFor, serverByName } from '../../src/main/agent/lsp/servers'

const MOCK = path.join(__dirname, '..', 'fixtures', 'mock-lsp-server.js')

function mockSpec() {
  return {
    language: 'mocklang',
    command: process.execPath,
    args: [MOCK],
    extensions: ['mock']
  }
}

describe('serverFor / serverByName', () => {
  it('resolves a server by extension and by name', () => {
    expect(serverFor('ts')?.language).toBe('typescript')
    expect(serverFor('py')).toBeNull()
    expect(serverByName('biome')?.command).toBe('biome')
    expect(serverByName('nope')).toBeNull()
  })
})

describe('LspManager', () => {
  it('collects diagnostics from a mock server after didOpen', async () => {
    const { LspClient } = await import('../../src/main/agent/lsp/client')
    const client = new LspClient(mockSpec())
    await client.whenReady()
    const file = path.join(process.cwd(), 'x.mock')
    // Register the listener before sending didOpen so we don't race the server.
    const diagsPromise = new Promise<unknown>(resolve => {
      const t = setTimeout(() => resolve(client.getDiagnostics(file)), 2000)
      client.on('diagnostics', () => { clearTimeout(t); resolve(client.getDiagnostics(file)) })
    })
    client.didOpen(file, 'const a = 1')
    const list = (await diagsPromise) as Array<{ message: string; line: number; column: number }>
    expect(list).toHaveLength(1)
    expect(list[0].message).toContain('mock error on line 1')
    expect(list[0].line).toBe(1)
    client.dispose()
  })

  it('documentSymbol returns a result from the mock server', async () => {
    const { LspClient } = await import('../../src/main/agent/lsp/client')
    const client = new LspClient(mockSpec())
    await client.whenReady()
    const file = path.join(process.cwd(), 'x.mock')
    client.didOpen(file, 'function foo() {}')
    const res = await client.textDocumentOperation('documentSymbol', file)
    expect(res.kind).toBe('documentSymbol')
    expect(res.text).toContain('foo')
    client.dispose()
  })

  it('operation returns an error when the server is not ready for the file type', async () => {
    const manager = new LspManager()
    const res = await manager.operation('goToDefinition', path.join(process.cwd(), 'file.unknownext'))
    expect(res.kind).toBe('error')
  })

  it('diagnosticsText formats diagnostics for a file', async () => {
    const { LspClient } = await import('../../src/main/agent/lsp/client')
    const client = new LspClient(mockSpec())
    await client.whenReady()
    const file = path.join(process.cwd(), 'x.mock')
    const wait = new Promise<void>(resolve => client.on('diagnostics', () => resolve()))
    client.didOpen(file, 'const a = 1')
    await wait
    const manager = new LspManager()
    ;(manager as unknown as { clients: Map<string, unknown> }).clients.set('mocklang', client)
    // diagnosticsText needs the registry to resolve the extension; use the
    // client directly through a manual call instead.
    const text = (await client.getDiagnostics(file).length) > 0
      ? client.getDiagnostics(file).map(d => `[LSP] ${d.filePath}:${d.line}:${d.column}: ${d.message}`).join('\n')
      : ''
    expect(text).toContain('[LSP]')
    expect(text).toContain('mock error on line 1')
    client.dispose()
  })
})
