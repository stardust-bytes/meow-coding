import path from 'node:path'
import { LspClient } from './client'
import type { LspServerSpec, Diagnostic, LspResult } from './client'
import { serverFor } from './servers'

export interface LspManagerOptions {
  diagnosticsTimeoutMs?: number
}

export class LspManager {
  private clients = new Map<string, LspClient>()
  private failed = new Set<string>()

  constructor(private opts: LspManagerOptions = {}) {}

  // Ensures a client exists for the file's language. Returns null if the
  // server binary is missing or a previous launch failed.
  ensure(filePath: string, text?: string): LspClient | null {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const spec = serverFor(ext)
    if (!spec) return null
    const key = spec.language
    if (this.failed.has(key)) return null
    let client = this.clients.get(key)
    if (!client) {
      client = new LspClient(spec)
      this.clients.set(key, client)
      client.whenReady().catch(() => {
        this.failed.add(key)
        this.clients.delete(key)
      })
    }
    if (text !== undefined) {
      client.didOpen(filePath, text)
    }
    return client
  }

  async open(filePath: string, text: string): Promise<LspClient | null> {
    const client = this.ensure(filePath)
    if (!client) return null
    client.didOpen(filePath, text)
    return client
  }

  async change(filePath: string, text: string): Promise<LspClient | null> {
    const client = this.ensure(filePath)
    if (!client) return null
    client.didChange(filePath, text)
    return client
  }

  async save(filePath: string): Promise<LspClient | null> {
    const client = this.ensure(filePath)
    if (!client) return null
    client.didSave(filePath)
    return client
  }

  // Sends didOpen + waits for publishDiagnostics, then returns them.
  async diagnosticsFor(filePath: string, text: string): Promise<Diagnostic[]> {
    const client = await this.open(filePath, text)
    if (!client) return []
    const timeout = this.opts.diagnosticsTimeoutMs ?? 3000
    const existing = client.getDiagnostics(filePath)
    if (existing.length > 0) return existing
    return new Promise<Diagnostic[]>((resolve) => {
      const timer = setTimeout(() => resolve(client.getDiagnostics(filePath)), timeout)
      const handler = (e: { filePath: string }) => {
        if (e.filePath === filePath) {
          clearTimeout(timer)
          client.removeListener('diagnostics', handler)
          resolve(client.getDiagnostics(filePath))
        }
      }
      client.on('diagnostics', handler)
    })
  }

  async operation(op: string, filePath: string, query?: string): Promise<LspResult> {
    const client = this.ensure(filePath)
    if (!client) return { kind: 'error', text: 'lsp: server not ready for this file type' }
    try {
      return await client.textDocumentOperation(op, filePath, query)
    } catch (err) {
      return { kind: 'error', text: `lsp: ${String(err)}` }
    }
  }

  // Returns LSP diagnostics for a file as a compact text block, or '' when
  // there are none (or LSP is unavailable).
  async diagnosticsText(filePath: string, text: string, max = 5): Promise<string> {
    const diags = await this.diagnosticsFor(filePath, text)
    if (diags.length === 0) return ''
    const lines = diags
      .slice(0, max)
      .map(d => `[LSP] ${d.filePath}:${d.line}:${d.column}: ${d.message}`)
    return lines.join('\n')
  }

  dispose(): void {
    for (const client of this.clients.values()) client.dispose()
    this.clients.clear()
    this.failed.clear()
  }
}
