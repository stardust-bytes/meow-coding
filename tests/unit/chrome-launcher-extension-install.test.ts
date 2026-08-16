import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureExtensionInstalled } from '../../src/main/browser/chrome-launcher'

describe('ensureExtensionInstalled', () => {
  it('re-syncs the target even when the manifest version matches, so files added without a version bump still propagate', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-ext-'))
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    mkdirSync(source, { recursive: true })
    mkdirSync(target, { recursive: true })

    const manifest = JSON.stringify({ version: '0.3.4' })
    writeFileSync(path.join(source, 'manifest.json'), manifest)
    writeFileSync(path.join(target, 'manifest.json'), manifest)
    // Source has a new icons folder the target never received, same version.
    mkdirSync(path.join(source, 'icons'), { recursive: true })
    writeFileSync(path.join(source, 'icons', '128x128.png'), 'fake-icon-bytes')

    ensureExtensionInstalled(source, target)

    expect(existsSync(path.join(target, 'icons', '128x128.png'))).toBe(true)
  })

  it('does nothing when the source directory does not exist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-ext-'))
    const source = path.join(root, 'does-not-exist')
    const target = path.join(root, 'target')
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ version: '1.0.0' }))

    expect(() => ensureExtensionInstalled(source, target)).not.toThrow()
    expect(existsSync(path.join(target, 'manifest.json'))).toBe(true)
  })

  it('creates the target directory when it does not exist yet', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-ext-'))
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    mkdirSync(source, { recursive: true })
    writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ version: '1.0.0' }))

    ensureExtensionInstalled(source, target)

    expect(existsSync(path.join(target, 'manifest.json'))).toBe(true)
  })
})
