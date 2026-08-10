import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src', 'browser-extension')
const out = path.join(root, 'out', 'browser-extension')

mkdirSync(out, { recursive: true })

await build({
  entryPoints: [
    path.join(src, 'background.ts'),
    path.join(src, 'content.ts'),
    path.join(src, 'popup.ts')
  ],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  outdir: out,
  logLevel: 'info'
})

cpSync(path.join(src, 'manifest.json'), path.join(out, 'manifest.json'))
cpSync(path.join(src, 'popup.html'), path.join(out, 'popup.html'))
console.log(`[build:extension] output: ${out}`)
