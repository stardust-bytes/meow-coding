import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SystemLogger } from '../../src/main/system-logger'

let dir: string
let logs: SystemLogger

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-syslog-'))
  logs = new SystemLogger(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SystemLogger', () => {
  it('appends a formatted line to the dated file', () => {
    logs.log('ERROR', 'main', 'boom')
    const names = readdirSync(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^\d{4}-\d{2}-\d{2}-log\.txt$/)
    const content = readFileSync(path.join(dir, names[0]), 'utf-8')
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\] \[main\] boom\n$/)
  })

  it('appends multiple lines to the same daily file', () => {
    logs.log('INFO', 'render', 'one')
    logs.log('WARN', 'agent', 'two')
    const names = readdirSync(dir)
    expect(names).toHaveLength(1)
    const content = readFileSync(path.join(dir, names[0]), 'utf-8')
    expect(content).toContain('[INFO] [render] one')
    expect(content).toContain('[WARN] [agent] two')
  })

  it('uses a new file when the injected clock crosses midnight', () => {
    let current = new Date('2026-08-04T10:00:00')
    const clocked = new SystemLogger(dir, () => current)
    clocked.log('ERROR', 'main', 'day one')
    current = new Date('2026-08-05T09:00:00')
    clocked.log('INFO', 'render', 'day two')
    const names = readdirSync(dir).sort()
    expect(names).toEqual(['2026-08-04-log.txt', '2026-08-05-log.txt'])
    expect(readFileSync(path.join(dir, '2026-08-04-log.txt'), 'utf-8')).toContain('[ERROR] [main] day one')
    expect(readFileSync(path.join(dir, '2026-08-05-log.txt'), 'utf-8')).toContain('[INFO] [render] day two')
  })

  it('prune removes dated files older than maxDays and keeps others', () => {
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const day = 24 * 60 * 60 * 1000
    const old = path.join(dir, `${stamp(new Date(Date.now() - 10 * day))}-log.txt`)
    const recent = path.join(dir, `${stamp(new Date(Date.now() - 1 * day))}-log.txt`)
    const other = path.join(dir, 'agent-xyz.log')
    writeFileSync(old, 'old')
    writeFileSync(recent, 'recent')
    writeFileSync(other, 'other')
    logs.prune(7)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(other)).toBe(true) // file không đúng pattern không bị đụng
  })

  it('constructor creates a deep log directory and log works there', () => {
    const bad = new SystemLogger(path.join(dir, 'no-such', 'deep'))
    expect(() => bad.log('ERROR', 'main', 'x')).not.toThrow()
    // thư mục được tự tạo
    expect(existsSync(path.join(dir, 'no-such', 'deep'))).toBe(true)
  })
})
