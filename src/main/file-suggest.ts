import { glob } from 'glob'
import { statSync } from 'node:fs'
import path from 'node:path'
import type { FileSuggestion } from '../shared/types'

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**']
const MAX_RESULTS = 20

export async function suggestFiles(cwd: string, prefix: string): Promise<FileSuggestion[]> {
  const clean = prefix.replace(/^@/, '').replace(/^\.\//, '')
  if (!clean) return []
  const matches = await glob(`${clean}*`, { cwd, posix: true, dot: false, ignore: IGNORE })
  const list = matches.sort().slice(0, MAX_RESULTS)
  return list.map(p => {
    let isDirectory = false
    try { isDirectory = statSync(path.join(cwd, p)).isDirectory() } catch { /* ignore */ }
    return { path: p, name: path.basename(p), isDirectory }
  })
}
