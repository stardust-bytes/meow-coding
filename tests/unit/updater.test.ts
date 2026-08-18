import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UpdaterStatusEvent } from '../../src/shared/types'
import type { UpdaterEnv } from '../../src/main/updater'

const { mockAutoUpdater, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    mockAutoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb)
      }),
      quitAndInstall: vi.fn()
    }
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

import { Updater } from '../../src/main/updater'

function makeEnv(overrides: Partial<UpdaterEnv> = {}): UpdaterEnv {
  return {
    isPackaged: true,
    isPortable: () => false,
    isAppImage: () => false,
    getCurrentVersion: () => '1.0.0',
    platform: 'win32',
    ...overrides
  }
}

function makeUpdater(env: UpdaterEnv = makeEnv()) {
  const events: UpdaterStatusEvent[] = []
  const updater = new Updater(e => events.push(e), env)
  return { events, updater }
}

describe('Updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    mockAutoUpdater.autoDownload = true
    mockAutoUpdater.autoInstallOnAppQuit = true
  })

  it('dev mode: manual check emits not-supported, auto check stays silent', async () => {
    const { events, updater } = makeUpdater(makeEnv({ isPackaged: false }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()

    events.length = 0
    await updater.check(false)
    expect(events).toEqual([])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('portable build: manual check emits not-supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ isPortable: () => true }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('linux without AppImage: manual check emits not-supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ platform: 'linux', isAppImage: () => false }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('linux with AppImage is supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ platform: 'linux', isAppImage: () => true }))
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'up-to-date', currentVersion: '1.0.0' }])
  })

  it('supported + newer version emits update-available with version and currentVersion', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([
      { type: 'checking' },
      {
        type: 'update-available',
        version: '2.1.0',
        currentVersion: '1.0.0',
        releaseNotes: undefined,
        releaseDate: '2026-08-18T00:00:00.000Z'
      }
    ])
  })

  it('passes through releaseNotes string and releaseDate when present', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.1.0',
        releaseDate: '2026-08-19T00:00:00.000Z',
        releaseNotes: '<h1>What\'s new</h1>'
      }
    })
    await updater.check(true)
    expect(events[1]).toMatchObject({
      type: 'update-available',
      releaseNotes: '<h1>What\'s new</h1>',
      releaseDate: '2026-08-19T00:00:00.000Z'
    })
  })

  it('takes the note of the first entry when releaseNotes is an array', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.1.0',
        releaseDate: '2026-08-19T00:00:00.000Z',
        releaseNotes: [
          { version: '2.1.0', note: '<p>latest</p>' },
          { version: '2.0.0', note: '<p>older</p>' }
        ]
      }
    })
    await updater.check(true)
    expect(events[1]).toMatchObject({ type: 'update-available', releaseNotes: '<p>latest</p>' })
  })

  it('supported + same version emits up-to-date', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'up-to-date', currentVersion: '1.0.0' }])
  })

  it('emits error when checkForUpdates rejects', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network down'))
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'error', message: 'network down' }])
  })

  it('forwards download-progress with a rounded percent', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('download-progress')!
    emit({ percent: 45.6, total: 100, transferred: 45.6, delta: 0, bytesPerSecond: 0 })
    expect(events).toEqual([{ type: 'download-progress', percent: 46 }])
  })

  it('forwards update-downloaded as downloaded with the new version', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('update-downloaded')!
    emit({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(events).toEqual([{ type: 'downloaded', version: '2.1.0' }])
  })

  it('forwards autoUpdater errors', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('error')!
    emit(new Error('boom'))
    expect(events).toEqual([{ type: 'error', message: 'boom' }])
  })

  it('install calls quitAndInstall and disables auto behaviors', () => {
    const { updater } = makeUpdater()
    updater.install()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(mockAutoUpdater.autoDownload).toBe(false)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('ignores a second check while one is in flight', async () => {
    const { events, updater } = makeUpdater()
    let resolveCheck!: (v: unknown) => void
    mockAutoUpdater.checkForUpdates.mockImplementation(
      () => new Promise(resolve => { resolveCheck = resolve })
    )
    const first = updater.check(true)
    await updater.check(true)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    resolveCheck({
      isUpdateAvailable: true,
      updateInfo: { version: '2.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await first
    expect(events.filter(e => e.type === 'checking')).toHaveLength(1)
  })
})
