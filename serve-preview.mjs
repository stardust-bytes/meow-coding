import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const port = 18472
createServer(async (_req, res) => {
  try {
    const data = await readFile('preview-update.png')
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(data)
  } catch { res.writeHead(404); res.end() }
}).listen(port, '127.0.0.1', () => console.log(`serving on ${port}`))
