import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { LogLevel, LogSource } from '../shared/types'

const pad = (n: number): string => String(n).padStart(2, '0')

function formatTs(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export class SystemLogger {
  constructor(
    private logDir: string,
    private now: () => Date = () => new Date()
  ) {
    mkdirSync(this.logDir, { recursive: true })
  }

  private fileFor(d: Date): string {
    return path.join(this.logDir, `${dateStamp(d)}-log.txt`)
  }

  log(level: LogLevel, source: LogSource, message: string): void {
    try {
      const line = `[${formatTs(this.now())}] [${level}] [${source}] ${message}\n`
      appendFileSync(this.fileFor(this.now()), line)
    } catch (err) {
      // Không dùng console.* ở đây — console đã bị patch (Task 3), sẽ đệ quy.
      process.stderr.write(`[system-log] append failed: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  prune(maxDays = 7): void {
    try {
      const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000
      for (const name of readdirSync(this.logDir)) {
        const m = /^(\d{4}-\d{2}-\d{2})-log\.txt$/.exec(name)
        if (!m) continue
        const ts = new Date(`${m[1]}T00:00:00`).getTime()
        if (ts < cutoff) {
          try {
            rmSync(path.join(this.logDir, name))
          } catch {
            /* file có thể bị xóa bởi tiến trình khác */
          }
        }
      }
    } catch {
      /* thư mục không tồn tại — bỏ qua */
    }
  }
}
