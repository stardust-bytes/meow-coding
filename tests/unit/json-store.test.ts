import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'

let dir: string
let file: string

beforeEach(() => {
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
})
