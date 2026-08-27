import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'

// Control how many renameSync calls throw a transient Windows "file locked"
// EPERM, so we can exercise the retry + fallback path deterministically.
const fsKontrol = vi.hoisted(() => ({ renameFailures: 0 }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (oldPath: string, newPath: string) => {
      if (fsKontrol.renameFailures > 0) {
        fsKontrol.renameFailures--
        const err = new Error('operation not permitted') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      }
      return actual.renameSync(oldPath, newPath)
    }
  }
})

let dir: string
let file: string

beforeEach(() => {
  fsKontrol.renameFailures = 0
  dir = mkdtempSync(path.join(tmpdir(), 'meow-json-'))
  file = path.join(dir, 'data.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createJsonStore', () => {
  it('returns [] when file does not exist', () => {
    expect(createJsonStore<number>(file).load()).toEqual([])
  })

  it('returns [] when file is corrupt', () => {
    writeFileSync(file, 'not-json{{{')
    expect(createJsonStore<number>(file).load()).toEqual([])
  })

  it('keeps a copy of a corrupt file instead of discarding it silently', () => {
    writeFileSync(file, 'not-json{{{')
    createJsonStore<number>(file).load()
    expect(readFileSync(file + '.corrupt', 'utf-8')).toBe('not-json{{{')
  })

  it('leaves the previous file intact when serialization fails', () => {
    const store = createJsonStore<Record<string, unknown>>(file)
    store.save([{ n: 1 }])
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => store.save([circular])).toThrow()
    expect(createJsonStore<Record<string, unknown>>(file).load()).toEqual([{ n: 1 }])
  })

  it('does not leave a temp file behind after saving', () => {
    createJsonStore<{ n: number }>(file).save([{ n: 1 }])
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('serves repeat loads from memory instead of re-reading the file', () => {
    const store = createJsonStore<{ n: number }>(file)
    store.save([{ n: 1 }])
    rmSync(file)
    expect(store.load()).toEqual([{ n: 1 }])
  })

  it('coalesces debounced saves into one write and flushes on demand', () => {
    const store = createJsonStore<{ n: number }>(file, { debounceMs: 50 })
    store.save([{ n: 1 }])
    store.save([{ n: 2 }])
    expect(existsSync(file)).toBe(false)
    store.flush?.()
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 2 }])
  })

  it('loads saved items and persists them', () => {
    const store = createJsonStore<{ n: number }>(file)
    store.save([{ n: 1 }, { n: 2 }])
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }, { n: 2 }])
    expect(existsSync(file)).toBe(true)
  })

  it('retries a transient Windows EPERM on rename and still saves', () => {
    fsKontrol.renameFailures = 3 // within the retry budget
    const store = createJsonStore<{ n: number }>(file)
    expect(() => store.save([{ n: 1 }])).not.toThrow()
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }])
  })

  it('falls back to an in-place write when rename stays locked, without crashing', () => {
    fsKontrol.renameFailures = 99 // exceeds the retry budget
    const store = createJsonStore<{ n: number }>(file)
    expect(() => store.save([{ n: 1 }])).not.toThrow()
    // The write still reached disk and no temp file is left behind.
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }])
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('does not crash when a debounced flush write is blocked by a Windows lock', () => {
    fsKontrol.renameFailures = 99
    const store = createJsonStore<{ n: number }>(file, { debounceMs: 50 })
    store.save([{ n: 1 }])
    expect(() => store.flush?.()).not.toThrow()
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }])
  })
})
