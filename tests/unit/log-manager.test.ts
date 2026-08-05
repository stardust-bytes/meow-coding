import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LogManager } from '../../src/main/log-manager'

let dir: string
let logs: LogManager

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-log-'))
  logs = new LogManager(dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('LogManager', () => {
  it('appends data to a per-agent file and creates it', () => {
    logs.append('a1', 'hello')
    logs.append('a1', ' world')
    const content = readFileSync(path.join(dir, 'a1.log'), 'utf-8')
    expect(content).toBe('hello world')
  })

  it('exposes the file path and existence', () => {
    expect(logs.exists('a1')).toBe(false)
    logs.append('a1', 'x')
    expect(logs.exists('a1')).toBe(true)
    expect(logs.pathFor('a1')).toBe(path.join(dir, 'a1.log'))
  })

  it('creates a nested log directory on construction', () => {
    const nested = path.join(dir, 'sub', 'deep')
    const nestedLogs = new LogManager(nested)
    nestedLogs.append('a1', 'x')
    expect(readFileSync(path.join(nested, 'a1.log'), 'utf-8')).toBe('x')
  })

  it('removes a per-agent log file', () => {
    logs.append('a1', 'x')
    expect(logs.exists('a1')).toBe(true)
    logs.remove('a1')
    expect(logs.exists('a1')).toBe(false)
  })

  it('remove tolerates a missing file', () => {
    expect(() => logs.remove('nope')).not.toThrow()
  })
})
