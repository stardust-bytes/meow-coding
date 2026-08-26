import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface JsonStore<T> {
  load(): T[]
  save(items: T[]): void
  /** Writes any debounced save immediately. No-op for stores that save eagerly. */
  flush?(): void
}

export interface JsonStoreOptions {
  /**
   * Batch saves that land within this window into a single write. Worth it for
   * hot stores (sessions.json is rewritten on every appended message and tool
   * result); leave at 0 for stores that change rarely.
   */
  debounceMs?: number
}

export function createJsonStore<T>(filePath: string, opts: JsonStoreOptions = {}): JsonStore<T> {
  const debounceMs = opts.debounceMs ?? 0
  // The file is owned by this process, so the in-memory copy is authoritative.
  // Re-parsing it on every read made a long session quadratic: the agent loop
  // reads the transcript several times per step.
  let cache: T[] | null = null
  let pending: T[] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  // Serialize before touching disk, then swap the file in with a rename so a
  // crash mid-write cannot leave a half-written file that reads as corrupt.
  const write = (items: T[]): void => {
    const json = JSON.stringify(items, null, 2)
    mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, json)
    renameSync(tmp, filePath)
  }

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending === null) return
    const items = pending
    pending = null
    write(items)
  }

  if (debounceMs > 0) {
    // A pending save must still reach disk when the app quits.
    process.on('exit', flush)
  }

  return {
    load(): T[] {
      if (cache) return cache
      if (!existsSync(filePath)) return (cache = [])
      const raw = readFileSync(filePath, 'utf-8')
      try {
        const parsed = JSON.parse(raw)
        cache = Array.isArray(parsed) ? (parsed as T[]) : []
      } catch {
        // Do not silently discard the user's data: park the unreadable file
        // next to the original so it can be recovered by hand.
        try {
          renameSync(filePath, `${filePath}.corrupt`)
        } catch {
          /* best effort */
        }
        cache = []
      }
      return cache
    },
    save(items: T[]): void {
      cache = items
      if (debounceMs <= 0) {
        write(items)
        return
      }
      pending = items
      if (!timer) timer = setTimeout(flush, debounceMs)
    },
    flush
  }
}
