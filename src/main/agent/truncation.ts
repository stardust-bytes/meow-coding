import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface TruncationOptions {
  maxBytes?: number
  maxLines?: number
  headBytes?: number
  tailBytes?: number
}

export const DEFAULT_MAX_BYTES = 51200
export const DEFAULT_MAX_LINES = 2000
const DEFAULT_HEAD_BYTES = 4000
const DEFAULT_TAIL_BYTES = 4000

export class TruncationStore {
  constructor(private dir: string) {
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      /* tolerate unwritable dir; truncate falls back to a plain slice */
    }
  }

  private fileFor(agentId: string, toolId: string): string {
    const safe = toolId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    return path.join(this.dir, `${agentId}-${safe}.txt`)
  }

  // Writes the full output to disk and returns a compact head+tail preview.
  // Returns the original text unchanged when it fits within the limits.
  truncate(
    agentId: string,
    toolId: string,
    text: string,
    opts: TruncationOptions = {}
  ): string {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    if (maxBytes <= 0 || text.length <= maxBytes) return text
    const headBytes = opts.headBytes ?? DEFAULT_HEAD_BYTES
    const tailBytes = opts.tailBytes ?? DEFAULT_TAIL_BYTES
    const filePath = this.fileFor(agentId, toolId)
    try {
      writeFileSync(filePath, text)
    } catch {
      // fall back to a plain slice when the file cannot be written
      return text.slice(0, headBytes) + '\n[truncated]\n' + text.slice(-tailBytes)
    }
    const head = text.slice(0, headBytes)
    const tail = text.slice(-tailBytes)
    return `${head}\n[Output truncated to ${text.length} chars; full output at ${filePath}]\n${tail}`
  }

  cleanup(days = 7): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    try {
      for (const entry of readdirSync(this.dir)) {
        const file = path.join(this.dir, entry)
        try {
          if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
        } catch {
          /* ignore per-file errors */
        }
      }
    } catch {
      /* dir may not exist */
    }
  }

  exists(agentId: string, toolId: string): boolean {
    return existsSync(this.fileFor(agentId, toolId))
  }
}
