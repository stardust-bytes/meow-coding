// tests/unit/chatgpt-web-manager.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatGptWebManager } from '../../src/main/chatgpt-web/manager'

describe('ChatGptWebManager', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'chatgpt-web-mgr-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('starts disabled and logged out', () => {
    const manager = new ChatGptWebManager(dir)
    expect(manager.getStatus()).toEqual({ enabled: false, loggedIn: false, verifiedAt: null })
  })

  it('setEnabled persists and reflects in getStatus', () => {
    const manager = new ChatGptWebManager(dir)
    const status = manager.setEnabled(true)
    expect(status.enabled).toBe(true)
    expect(new ChatGptWebManager(dir).getStatus().enabled).toBe(true)
  })

  it('getModelRefsIfActive is empty unless both enabled and logged in', () => {
    const manager = new ChatGptWebManager(dir)
    expect(manager.getModelRefsIfActive()).toEqual([])
    manager.setEnabled(true)
    expect(manager.getModelRefsIfActive()).toEqual([])
  })

  it('login delegates to the injected login function and updates status', async () => {
    const manager = new ChatGptWebManager(dir, {
      login: vi.fn(async () => ({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' }))
    })
    manager.setEnabled(true)
    const status = await manager.login()
    expect(status).toEqual({ enabled: true, loggedIn: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    expect(manager.getModelRefsIfActive()).toHaveLength(5)
  })

  it('logout clears the session and disables the provider from the picker again', async () => {
    const manager = new ChatGptWebManager(dir, {
      login: vi.fn(async () => ({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' }))
    })
    manager.setEnabled(true)
    await manager.login()
    const status = manager.logout()
    expect(status.loggedIn).toBe(false)
    expect(manager.getModelRefsIfActive()).toEqual([])
  })

  it('login() passes userDataDir to the login function', async () => {
    const loginFn = vi.fn(async () => ({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' }))
    const manager = new ChatGptWebManager(dir, { login: loginFn })
    await manager.login()
    expect(loginFn).toHaveBeenCalledTimes(1)
    const callArgs = loginFn.mock.calls[0]
    expect(callArgs[1]).toBe(dir)
  })

  it('logout() removes storage-state.verified.json and browser-profile/', async () => {
    const fs = await import('node:fs')
    const profileDir = path.join(dir, 'browser-profile')
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'storage-state.json'), '{}')
    fs.writeFileSync(path.join(dir, 'storage-state.verified.json'), '{}')

    const manager = new ChatGptWebManager(dir)
    manager.logout()

    expect(fs.existsSync(path.join(dir, 'storage-state.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'storage-state.verified.json'))).toBe(false)
    expect(fs.existsSync(profileDir)).toBe(false)
  })
})
