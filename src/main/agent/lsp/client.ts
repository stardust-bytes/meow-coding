import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'

export interface LspServerSpec {
  language: string
  command: string
  args: string[]
  extensions: string[]
}

export interface Diagnostic {
  filePath: string
  line: number
  column: number
  message: string
  severity: number
}

export interface Position {
  line: number
  character: number
}

export interface LspLocation {
  uri: string
  range: { start: Position; end: Position }
}

export interface LspResult {
  kind: 'definition' | 'references' | 'hover' | 'documentSymbol' | 'error'
  text: string
}

function which(name: string): boolean {
  return process.env.PATH?.split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .some(dir => {
      const candidates = process.platform === 'win32'
        ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
        : [name]
      return candidates.some(c => existsSync(`${dir}\\${c}`) || existsSync(`${dir}/${c}`))
    }) ?? false
}

export class LspClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private initialized = false
  private diagnostics = new Map<string, Diagnostic[]>()
  private ready: Promise<void>

  constructor(private spec: LspServerSpec) {
    super()
    this.ready = this.launch()
  }

  private launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = specToCommand(this.spec)
      if (!cmd) {
        reject(new Error(`lsp: ${this.spec.language} server "${this.spec.command}" not found`))
        return
      }
      try {
        this.proc = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (err) {
        reject(err as Error)
        return
      }
      this.proc.stderr.on('data', () => { /* ignore server logs */ })
      this.proc.stdout.on('data', (d) => this.onData(d.toString()))
      this.proc.on('exit', () => {
        for (const { reject } of this.pending.values()) reject(new Error('lsp: server exited'))
        this.pending.clear()
        this.initialized = false
      })
      this.request('initialize', {
        processId: process.pid,
        rootUri: null,
        capabilities: {}
      }).then(() => {
        this.initialized = true
        void this.notify('initialized', {})
        resolve()
      }).catch(reject)
    })
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  isReady(): boolean {
    return this.initialized
  }

  private onData(data: string): void {
    this.buffer += data
    let idx: number
    while ((idx = this.buffer.indexOf('\r\n\r\n')) >= 0) {
      const header = this.buffer.slice(0, idx)
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) {
        this.buffer = this.buffer.slice(idx + 4)
        continue
      }
      const len = Number(m[1])
      const start = idx + 4
      if (this.buffer.length < start + len) break
      const body = this.buffer.slice(start, start + len)
      this.buffer = this.buffer.slice(start + len)
      try {
        this.handleMessage(JSON.parse(body))
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as { uri: string; diagnostics: Array<{ range: { start: Position }; message: string; severity?: number }> }
      const filePath = normalizePath(params.uri)
      const diags: Diagnostic[] = (params.diagnostics ?? []).map(d => ({
        filePath,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        message: d.message,
        severity: d.severity ?? 1
      }))
      this.diagnostics.set(filePath, diags)
      this.emit('diagnostics', { filePath, diagnostics: diags })
      return
    }
    if (msg.id !== undefined && this.pending.has(msg.id as number)) {
      const { resolve, reject } = this.pending.get(msg.id as number)!
      this.pending.delete(msg.id as number)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(msg: unknown): void {
    const body = JSON.stringify(msg)
    this.proc?.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  didOpen(filePath: string, text: string): void {
    void this.notify('textDocument/didOpen', {
      textDocument: { uri: toUri(filePath), languageId: this.spec.language, version: 1, text }
    })
  }

  didChange(filePath: string, text: string): void {
    void this.notify('textDocument/didChange', {
      textDocument: { uri: toUri(filePath), version: 2 },
      contentChanges: [{ text }]
    })
  }

  didSave(filePath: string): void {
    void this.notify('textDocument/didSave', { textDocument: { uri: toUri(filePath) } })
  }

  getDiagnostics(filePath: string): Diagnostic[] {
    return this.diagnostics.get(normalizePath(filePath)) ?? []
  }

  async textDocumentOperation(op: string, filePath: string, query?: string): Promise<LspResult> {
    const uri = toUri(filePath)
    const params: Record<string, unknown> = { textDocument: { uri } }
    if (op === 'hover') params.position = { line: 0, character: 0 }
    if (op === 'documentSymbol') {
      const res = await this.request('textDocument/documentSymbol', params)
      return { kind: 'documentSymbol', text: JSON.stringify(res, null, 2) }
    }
    if (op === 'findReferences') {
      params.position = { line: 0, character: 0 }
      params.context = { includeDeclaration: true }
      const res = (await this.request('textDocument/references', params)) as LspLocation[] | null
      return { kind: 'references', text: formatLocations(res) }
    }
    if (op === 'goToDefinition') {
      params.position = { line: 0, character: 0 }
      const res = (await this.request('textDocument/definition', params)) as LspLocation | LspLocation[] | null
      const list = Array.isArray(res) ? res : (res ? [res] : [])
      return { kind: 'definition', text: formatLocations(list) }
    }
    if (op === 'hover') {
      const res = await this.request('textDocument/hover', params)
      return { kind: 'hover', text: JSON.stringify(res, null, 2) }
    }
    return { kind: 'error', text: `lsp: unsupported operation ${op}` }
  }

  dispose(): void {
    this.proc?.kill()
    this.proc = null
  }
}

function specToCommand(spec: LspServerSpec): { command: string; args: string[] } | null {
  if (spec.command.includes('/') || spec.command.includes('\\')) {
    return { command: spec.command, args: spec.args }
  }
  if (!which(spec.command)) return null
  return { command: spec.command, args: spec.args }
}

function normalizePath(uri: string): string {
  let p = uri.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1')
  p = p.replace(/\\/g, '/')
  return p
}

function toUri(filePath: string): string {
  return `file://${filePath.replace(/\\/g, '/')}`
}

function formatLocations(locations: LspLocation[] | null | undefined): string {
  if (!locations || locations.length === 0) return '(no results)'
  return locations
    .map(l => {
      const file = normalizePath(l.uri)
      return `${file}:${l.range.start.line + 1}:${l.range.start.character + 1}`
    })
    .join('\n')
}
