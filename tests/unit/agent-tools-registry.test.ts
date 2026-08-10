import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'

let dir = ''
afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('createDefaultTools', () => {
  it('adds the office tool when getUserDataDir is provided', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-reg-'))
    const tools = createDefaultTools({ getUserDataDir: () => dir })
    expect(tools.has('office')).toBe(true)
  })

  it('omits the office tool without getUserDataDir', () => {
    const tools = createDefaultTools({})
    expect(tools.has('office')).toBe(false)
  })
})

describe('default permission', () => {
  it('defaults office permission to ask', () => {
    expect(DEFAULT_MEOW_CONFIG.permission.office).toBe('ask')
  })
})
