// Minimal mock LSP server over stdio that answers initialize/initialized,
// responds to textDocument/documentSymbol with one symbol, and emits
// textDocument/publishDiagnostics after didOpen.
process.stdin.setEncoding('utf8')

let buffer = ''

process.stdin.on('data', (chunk) => {
  buffer += chunk
  let frame
  while ((frame = readFrame(buffer))) {
    buffer = frame.rest
    handle(frame.body)
  }
})

function send(msg) {
  const body = JSON.stringify(msg)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function readFrame(raw) {
  const idx = raw.indexOf('\r\n\r\n')
  if (idx < 0) return null
  const m = /Content-Length:\s*(\d+)/i.exec(raw.slice(0, idx))
  if (!m) return null
  const len = Number(m[1])
  const start = idx + 4
  if (raw.length < start + len) return null
  return { body: JSON.parse(raw.slice(start, start + len)), rest: raw.slice(start + len) }
}

function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } })
    return
  }
  if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params.textDocument.uri
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            message: 'mock error on line 1'
          }
        ]
      }
    })
    return
  }
  if (msg.method === 'textDocument/documentSymbol') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: [{ name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } }]
    })
    return
  }
  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: null })
  }
}
