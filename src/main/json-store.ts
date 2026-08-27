import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// On Windows, `renameSync` over an existing file throws EPERM/EACCES/EBUSY
// while the destination is transiently locked (antivirus scan, Search
// Indexer, OneDrive). Retry with backoff to ride it out before falling back.
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80]
const sleepBuf = new Int32Array(new SharedArrayBuffer(4))

/** renameSync, retried on the transient "locked" error codes. */
function renameOverwrite(tmp: string, filePath: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, filePath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!transient || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
      Atomics.wait(sleepBuf, 0, 0, RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}

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
    try {
      renameOverwrite(tmp, filePath)
    } catch {
      // The destination stayed locked through every retry (e.g. antivirus held
      // it open). Fall back to an in-place overwrite rather than crashing or
      // dropping the write; a crash mid-write is recovered by load() parking
      // the file as `.corrupt`. Clean up the orphaned temp file.
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      writeFileSync(filePath, json)
    }
  }

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending === null) return
    const items = pending
    pending = null
    // Deferred writes run on a timer or at-quit; a failed write must never
    // crash the app or block shutdown. The in-memory cache stays authoritative
    // and the next save will retry.
    try {
      write(items)
    } catch {
      /* best effort */
    }
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
