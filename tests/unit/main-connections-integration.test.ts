import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const hoisted = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const userData = mkdtempSync(join(tmpdir(), 'meow-main-'))
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const appListeners = new Map<string, (...args: unknown[]) => void>()
  return { userData, handlers, appListeners }
})

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? hoisted.userData : path.join(hoisted.userData, name)),
    requestSingleInstanceLock: () => true,
    quit: vi.fn(),
    exit: vi.fn(),
    whenReady: () => new Promise(() => {}),
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en-US',
    getName: () => 'meow-coding',
    on: (event: string, cb: (...args: unknown[]) => void) => hoisted.appListeners.set(event, cb),
    setPath: vi.fn(),
    show: vi.fn(),
    isMinimized: vi.fn(() => false),
    focus: vi.fn()
  },
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => hoisted.handlers.set(channel, fn)
  },
  Notification: class {
    on(): this { return this }
    show(): void {}
  },
  shell: { openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, '')
  }
}))

import { Channels } from '../../src/shared/ipc'
import type { ModelRef } from '../../src/shared/types'
import { mainApp, registerIpcHandlers } from '../../src/main/index'

afterEach(() => {
  hoisted.handlers.clear()
})

describe('main-process connection integration', () => {
  it('registers typed connection IPC handlers that delegate to the connections manager', () => {
    registerIpcHandlers()
    for (const channel of [
      Channels.ConnectionList,
      Channels.ConnectionConnectCodex,
      Channels.ConnectionDisconnect,
      Channels.ConnectionSetActive,
      Channels.ConnectionGetModels
    ]) {
      expect(hoisted.handlers.has(channel)).toBe(true)
    }
    // listConnections delegates to the manager (no accounts yet).
    const list = hoisted.handlers.get(Channels.ConnectionList)!.call(null)
    expect(list).toEqual([])
    // Renderer input is validated before forwarding.
    const disconnect = hoisted.handlers.get(Channels.ConnectionDisconnect)!
    expect(() => disconnect.call(null, null as unknown as string)).toThrow(/invalid account id/)
  })

  it('stores the full ModelRef including accountId on model selection', () => {
    const ws = mainApp.workspaces.add('/proj', 'Proj')
    mainApp.workspaces.addAgent('/proj', {
      id: 'a1', name: 'meow', templateId: 'meow', cwd: '/proj', kind: 'native'
    })
    expect(ws).toBeTruthy()
    const ref: ModelRef = { provider: 'codex', accountId: 'acct-a', model: 'gpt-5.3-codex' }
    mainApp.setAgentModel('a1', ref)
    const persisted = mainApp.workspaces.get('/proj')!.agents.find(a => a.id === 'a1')!
    expect(persisted.model).toBe('codex/gpt-5.3-codex')
    expect(persisted.accountId).toBe('acct-a')
  })

  it('disposes the connections manager during before-quit shutdown', async () => {
    const disposeSpy = vi.spyOn(mainApp.connections, 'dispose').mockResolvedValue(undefined)
    const beforeQuit = hoisted.appListeners.get('before-quit')!
    const event = { preventDefault: vi.fn() }
    beforeQuit.call(null, event)
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(disposeSpy).toHaveBeenCalled()
    })
  })
})
