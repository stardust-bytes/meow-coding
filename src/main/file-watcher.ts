import { readdir, stat } from 'node:fs/promises'
import { statSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

const IGNORED = new Set(['node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage'])
const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'css', 'scss', 'html', 'htm',
  'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'sh', 'yml', 'yaml', 'toml',
  'xml', 'sql', 'vue', 'svelte', 'astro', 'txt'
])

export type ChangedCallback = (files: string[]) => void

interface FileStat {
  mtimeMs: number
  size: number
}

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private changed = new Set<string>()
  // Baseline (mtime, size) per relative path, built by a background walk when
  // watching starts. fs.watch on Windows fires for atime/attribute touches
  // (AV scans, indexers, utimes) with unchanged content; comparing against the
  // baseline keeps those spurious events out of artifact recording.
  private baseline = new Map<string, FileStat>()

  constructor(private projectPath: string, private cb: ChangedCallback) {}

  start(): void {
    void this.scanBaseline()
    try {
      this.watcher = watch(this.projectPath, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const rel = filename.toString().replace(/\\/g, '/')
        if (this.ignored(rel)) return
        const ext = rel.split('.').pop() ?? ''
        if (!TEXT_EXT.has(ext)) return
        this.changed.add(rel)
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), 500)
      })
    } catch {
      /* watcher unavailable */
    }
  }

  // True when the file is new or its (mtime, size) moved since the baseline;
  // false for spurious events (reads/touches that leave content untouched).
  hasContentChanged(rel: string): boolean {
    const abs = path.join(this.projectPath, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      return false // deleted — not a create/edit artifact
    }
    const stat: FileStat = { mtimeMs: st.mtimeMs, size: st.size }
    const prev = this.baseline.get(rel)
    this.baseline.set(rel, stat)
    if (!prev) return true // new file
    return prev.mtimeMs !== stat.mtimeMs || prev.size !== stat.size
  }

  private async scanBaseline(): Promise<void> {
    const next = new Map<string, FileStat>()
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(abs)
          continue
        }
        const ext = path.extname(entry.name).slice(1).toLowerCase()
        if (!TEXT_EXT.has(ext)) continue
        try {
          const st = await stat(abs)
          const rel = path.relative(this.projectPath, abs).replace(/\\/g, '/')
          next.set(rel, { mtimeMs: st.mtimeMs, size: st.size })
        } catch {
          /* file vanished mid-scan */
        }
      }
    }
    try {
      await walk(this.projectPath)
    } catch {
      /* walk unavailable */
    }
    this.baseline = next
  }

  private ignored(rel: string): boolean {
    return rel.split('/').some(seg => IGNORED.has(seg))
  }

  private flush(): void {
    this.timer = null
    if (this.changed.size === 0) return
    const files = [...this.changed].slice(0, 100)
    this.changed.clear()
    this.cb(files)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.changed.clear()
    this.baseline.clear()
    this.watcher?.close()
    this.watcher = null
  }
}

export function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return TEXT_EXT.has(ext)
}
