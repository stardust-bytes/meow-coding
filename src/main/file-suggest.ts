import { glob } from 'glob'
import { statSync } from 'node:fs'
import path from 'node:path'
import type { FileSuggestion } from '../shared/types'

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**']
const MAX_RESULTS = 20

export async function suggestFiles(cwd: string, prefix: string): Promise<FileSuggestion[]> {
  const clean = prefix
    .replace(/^@/, '')
    .replace(/^\.\//, '')
    // Windows users may type backslash paths; glob only understands "/".
    .replace(/\\/g, '/')
  if (!clean) return []
  // Bare names deep-search basenames anywhere in the tree ("@ChatInput" → a
  // nested src/renderer/.../ChatInput.tsx); prefixes with "/" keep path
  // drill-down matching at the root and any nested location.
  const patterns = clean.includes('/')
    ? [`${clean}*`, `**/${clean}*`]
    : [`**/*${clean}*`]
  const found = new Set<string>()
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd, posix: true, dot: false, ignore: IGNORE })
    for (const p of matches) found.add(p)
  }
  const list = [...found]
    .sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length
      if (depthDiff !== 0) return depthDiff
      return a < b ? -1 : a > b ? 1 : 0
    })
    .slice(0, MAX_RESULTS)
  return list.map(p => {
    let isDirectory = false
    try { isDirectory = statSync(path.join(cwd, p)).isDirectory() } catch { /* ignore */ }
    return { path: p, name: path.basename(p), isDirectory }
  })
}
