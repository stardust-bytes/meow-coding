import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GatewayRequestLog } from '../../shared/types'

// Request logs for the local gateway — one JSON object per line, rotated per
// day. Only metadata is stored (no tokens/body).
export class GatewayLogStore {
  constructor(private readonly dir: string) {}

  private fileFor(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return path.join(this.dir, `${y}-${m}-${d}.jsonl`)
  }

  append(entry: Omit<GatewayRequestLog, 'ts'>): void {
    mkdirSync(this.dir, { recursive: true })
    const line = JSON.stringify({ ts: Date.now(), ...entry })
    // Append via read+write is fine for low traffic; keeps files appendable.
    const file = this.fileFor(new Date())
    const prev = existsSync(file) ? readFileSync(file, 'utf-8') : ''
    writeFileSync(file, prev + line + '\n')
  }

  list(limit = 200): GatewayRequestLog[] {
    const file = this.fileFor(new Date())
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    const entries: GatewayRequestLog[] = []
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as GatewayRequestLog)
      } catch {
        // Skip corrupted line.
      }
    }
    return entries
  }

  clear(): void {
    const file = this.fileFor(new Date())
    if (existsSync(file)) rmSync(file, { force: true })
  }
}
