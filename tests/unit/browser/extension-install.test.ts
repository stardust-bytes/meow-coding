import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureExtensionInstalled } from '../../../src/main/browser/chrome-launcher'

let src: string
let dst: string

beforeEach(() => {
  src = mkdtempSync(path.join(tmpdir(), 'meow-ext-src-'))
  dst = mkdtempSync(path.join(tmpdir(), 'meow-ext-dst-'))
})

afterEach(() => {
  rmSync(src, { recursive: true, force: true })
  rmSync(dst, { recursive: true, force: true })
})

function writeManifest(dir: string, version: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version }))
}

describe('ensureExtensionInstalled', () => {
  it('copies the extension when the target is missing', () => {
    writeManifest(src, '0.1.0')
    writeFileSync(path.join(src, 'background.js'), 'x')
    ensureExtensionInstalled(src, dst)
    expect(existsSync(path.join(dst, 'manifest.json'))).toBe(true)
    expect(existsSync(path.join(dst, 'background.js'))).toBe(true)
  })

  it('skips copying when versions match', () => {
    writeManifest(src, '0.1.0')
    writeManifest(dst, '0.1.0')
    writeFileSync(path.join(dst, 'keep.txt'), 'keep')
    ensureExtensionInstalled(src, dst)
    expect(existsSync(path.join(dst, 'keep.txt'))).toBe(true)
  })

  it('re-copies when the source version is newer', () => {
    writeManifest(src, '0.2.0')
    writeFileSync(path.join(src, 'new.js'), 'y')
    writeManifest(dst, '0.1.0')
    ensureExtensionInstalled(src, dst)
    expect(existsSync(path.join(dst, 'new.js'))).toBe(true)
  })

  it('no-ops when the source dir does not exist', () => {
    const missing = path.join(src, 'nope')
    ensureExtensionInstalled(missing, dst)
    expect(existsSync(path.join(dst, 'manifest.json'))).toBe(false)
  })
})
