import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry } from '../shared/types'

export const IGNORED_DIRS = ['node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage']

export function shouldIgnore(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.includes(name)
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

export async function listDir(absPath: string): Promise<DirEntry[]> {
  const dirents = await readdir(absPath, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const d of dirents) {
    if (shouldIgnore(d.name)) continue
    // Symlink to a directory: treat as file to avoid cycles on expansion.
    const isDirectory = d.isDirectory() && !d.isSymbolicLink()
    entries.push({ name: d.name, path: path.join(absPath, d.name), isDirectory })
  }
  return sortEntries(entries)
}
