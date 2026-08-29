import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadProjectHooks, matchHook, mergeHooksConfig } from '../../src/main/agent/hooks'
import type { HooksConfig } from '../../src/main/agent/hooks'
import { DEFAULT_MEOW_CONFIG, loadMeowConfig, settingsToConfig, configToSettings } from '../../src/main/agent/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-hooks-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('matchHook', () => {
  it('matches "*" and empty as catch-all', () => {
    expect(matchHook('*', 'Bash')).toBe(true)
    expect(matchHook('', 'anything')).toBe(true)
  })

  it('matches an exact tool name', () => {
    expect(matchHook('bash', 'bash')).toBe(true)
    expect(matchHook('bash', 'write')).toBe(false)
  })

  it('matches | and , separated lists', () => {
    expect(matchHook('edit|write', 'write')).toBe(true)
    expect(matchHook('edit, write', 'edit')).toBe(true)
    expect(matchHook('edit|write', 'read')).toBe(false)
  })

  it('treats anything else as an unanchored regex', () => {
    expect(matchHook('^mcp__', 'mcp__memory__read')).toBe(true)
    expect(matchHook('mcp__memory__.*', 'mcp__memory__write')).toBe(true)
    expect(matchHook('^mcp__', 'write')).toBe(false)
  })

  it('is case-sensitive and rejects a bad regex without throwing', () => {
    expect(matchHook('Write', 'write')).toBe(false)
    expect(matchHook('(', 'write')).toBe(false)
  })
})

describe('loadProjectHooks', () => {
  it('loads .meow/hooks.json when present', () => {
    mkdirSync(path.join(dir, '.meow'), { recursive: true })
    writeFileSync(
      path.join(dir, '.meow', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ matcher: 'edit|write', hooks: [{ type: 'command', command: 'check.sh' }] }]
      })
    )
    const cfg = loadProjectHooks(dir)
    expect(cfg.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'check.sh' })
  })

  it('returns {} when the file is missing', () => {
    expect(loadProjectHooks(dir)).toEqual({})
  })

  it('returns {} for malformed JSON instead of throwing', () => {
    mkdirSync(path.join(dir, '.meow'), { recursive: true })
    writeFileSync(path.join(dir, '.meow', 'hooks.json'), '{ not json')
    expect(loadProjectHooks(dir)).toEqual({})
  })
})

describe('mergeHooksConfig', () => {
  it('concatenates groups per event so both scopes run, global first', () => {
    const globalCfg: HooksConfig = {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'g.sh' }] }]
    }
    const projectCfg: HooksConfig = {
      PreToolUse: [{ matcher: 'write', hooks: [{ type: 'command', command: 'p.sh' }] }]
    }
    const merged = mergeHooksConfig(globalCfg, projectCfg)
    expect(merged.PreToolUse).toHaveLength(2)
    expect(merged.PreToolUse?.[0].hooks[0]).toMatchObject({ command: 'g.sh' })
    expect(merged.PreToolUse?.[1].hooks[0]).toMatchObject({ command: 'p.sh' })
  })

  it('drops events that no scope defines', () => {
    const merged = mergeHooksConfig(undefined, { Stop: [{ matcher: '*', hooks: [] }] })
    expect(merged.PreToolUse).toBeUndefined()
    expect(merged.PostToolUse).toBeUndefined()
    expect(merged.Stop).toHaveLength(1)
  })
})

describe('meow.json hooks key', () => {
  it('loads a hooks key from meow.json', () => {
    const file = path.join(dir, 'meow.json')
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x.sh' }] }] }
      })
    )
    const cfg = loadMeowConfig(file)
    expect(cfg.hooks?.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'x.sh' })
  })

  it('defaults to undefined hooks when absent', () => {
    expect(DEFAULT_MEOW_CONFIG.hooks).toBeUndefined()
    const file = path.join(dir, 'meow.json')
    writeFileSync(file, JSON.stringify({}))
    expect(loadMeowConfig(file).hooks).toBeUndefined()
  })

  it('drops empty event arrays so an empty hooks object normalizes away', () => {
    const file = path.join(dir, 'meow.json')
    writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [], Stop: [] } }))
    expect(loadMeowConfig(file).hooks).toBeUndefined()
  })

  // Hooks are file-edited, not a settings-UI field: saving settings must carry
  // them through from the base config instead of wiping them.
  it('preserves hooks through a settings round-trip', () => {
    const base = {
      ...DEFAULT_MEOW_CONFIG,
      hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command' as const, command: 'done.sh' }] }] }
    }
    const saved = settingsToConfig(configToSettings(base), base)
    expect(saved.hooks?.Stop?.[0].hooks[0]).toMatchObject({ command: 'done.sh' })
  })
})
