import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
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

  it('loads saved items and persists them', () => {
    const store = createJsonStore<{ n: number }>(file)
    store.save([{ n: 1 }, { n: 2 }])
    expect(createJsonStore<{ n: number }>(file).load()).toEqual([{ n: 1 }, { n: 2 }])
    expect(existsSync(file)).toBe(true)
  })
})
