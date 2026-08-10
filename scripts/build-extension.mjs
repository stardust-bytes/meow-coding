import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'out', 'browser-extension')

mkdirSync(out, { recursive: true })
console.log(`[build:extension] out dir ready: ${out}`)
