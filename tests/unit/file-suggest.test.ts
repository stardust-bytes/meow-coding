import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { suggestFiles } from '../../src/main/file-suggest'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-suggest-'))
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  writeFileSync(path.join(dir, 'src', 'a.ts'), 'x')
  writeFileSync(path.join(dir, 'src', 'b.ts'), 'y')
  writeFileSync(path.join(dir, 'node_modules', 'x.ts'), 'z')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('suggestFiles', () => {
  it('returns relative paths matching prefix, ignoring node_modules/.git', async () => {
    const res = await suggestFiles(dir, 'src/')
    expect(res.map(r => r.path)).toContain('src/a.ts')
    expect(res.map(r => r.path)).toContain('src/b.ts')
    expect(res.some(r => r.path.includes('node_modules'))).toBe(false)
    expect(res.length).toBeLessThanOrEqual(20)
  })

  it('returns empty for an empty prefix', async () => {
    const res = await suggestFiles(dir, '')
    expect(res).toEqual([])
  })

  it('marks directories', async () => {
    const res = await suggestFiles(dir, 'src')
    const src = res.find(r => r.path === 'src')
    expect(src).toBeDefined()
    expect(src?.isDirectory).toBe(true)
  })
})
