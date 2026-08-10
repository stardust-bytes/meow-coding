import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatGptWebSessionStore } from '../../src/main/chatgpt-web/session-store'

describe('ChatGptWebSessionStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'chatgpt-web-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('defaults to disabled with no chromeExecutablePath when no config file exists', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.loadConfig()).toEqual({ enabled: false, chromeExecutablePath: undefined })
  })

  it('round-trips saved config', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.saveConfig({ enabled: true, chromeExecutablePath: '/opt/chrome' })
    expect(store.loadConfig()).toEqual({ enabled: true, chromeExecutablePath: '/opt/chrome' })
  })

  it('exposes a storageStatePath inside the given dir', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.storageStatePath()).toBe(path.join(dir, 'storage-state.json'))
  })

  it('returns null verified marker when never logged in', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.readVerifiedMarker()).toBeNull()
  })

  it('round-trips the verified marker', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.writeVerifiedMarker({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    expect(store.readVerifiedMarker()).toEqual({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
  })

  it('clearSession removes the storage state and verified marker but keeps config', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.saveConfig({ enabled: true })
    store.writeVerifiedMarker({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    store.clearSession()
    expect(store.readVerifiedMarker()).toBeNull()
    expect(existsSync(store.storageStatePath())).toBe(false)
    expect(store.loadConfig().enabled).toBe(true)
  })
})
