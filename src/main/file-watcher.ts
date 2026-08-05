import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

const IGNORED = new Set(['node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage'])
const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'css', 'scss', 'html', 'htm',
  'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'sh', 'yml', 'yaml', 'toml',
  'xml', 'sql', 'vue', 'svelte', 'astro', 'txt'
])

export type ChangedCallback = (files: string[]) => void

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private changed = new Set<string>()

  constructor(private projectPath: string, private cb: ChangedCallback) {}

  start(): void {
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
    this.watcher?.close()
    this.watcher = null
  }
}

export function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return TEXT_EXT.has(ext)
}
