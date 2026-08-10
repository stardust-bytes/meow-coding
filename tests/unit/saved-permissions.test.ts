import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SavedPermissions, type SavedPermission } from '../../src/main/agent/saved-permissions'

let dir: string
let saved: SavedPermissions
const project = 'D:\\GitHub\\some-project'

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-saved-perm-'))
  saved = new SavedPermissions(createJsonStore<SavedPermission>(path.join(dir, 'permissions.json')))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SavedPermissions', () => {
  it('remembers a plain always-allow for an exact tool name', () => {
    expect(saved.isAllowed(project, 'bash')).toBe(false)
    saved.save(project, 'bash')
    expect(saved.isAllowed(project, 'bash')).toBe(true)
    expect(saved.isAllowed(project, 'write')).toBe(false)
  })

  it('scopes an MCP tool always-allow to the whole server, not just that one action', () => {
    saved.save(project, 'mcp__playwright__browser_navigate')
    // The exact tool just approved is allowed...
    expect(saved.isAllowed(project, 'mcp__playwright__browser_navigate')).toBe(true)
    // ...and so is a different action from the same MCP server, never
    // explicitly approved before — this is the bug: previously each distinct
    // browser_* action needed its own separate "Always Allow" click.
    expect(saved.isAllowed(project, 'mcp__playwright__browser_click')).toBe(true)
    expect(saved.isAllowed(project, 'mcp__playwright__browser_snapshot')).toBe(true)
  })

  it('does not let one MCP server always-allow leak into another server', () => {
    saved.save(project, 'mcp__playwright__browser_navigate')
    expect(saved.isAllowed(project, 'mcp__other-server__do_thing')).toBe(false)
  })

  it('does not leak an always-allow across projects', () => {
    saved.save(project, 'mcp__playwright__browser_navigate')
    expect(saved.isAllowed('D:\\GitHub\\other-project', 'mcp__playwright__browser_click')).toBe(false)
  })

  it('is idempotent when the same MCP server is approved again', () => {
    saved.save(project, 'mcp__playwright__browser_navigate')
    saved.save(project, 'mcp__playwright__browser_click')
    expect(saved.isAllowed(project, 'mcp__playwright__browser_type')).toBe(true)
  })
})
