import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const trayInstance = {
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn()
}
const menuInstance = { append: vi.fn() }
const buildFromTemplateMock = vi.fn()
const menuItemCtor = vi.fn()
const showMock = vi.fn()
const hideMock = vi.fn()
const restoreMock = vi.fn()
const focusMock = vi.fn()
const setTemplateImageMock = vi.fn()
const trayCtor = vi.fn()

vi.mock('electron', () => ({
  Tray: class {
    constructor(...args: unknown[]) {
      trayCtor(...args)
      return trayInstance
    }
  },
  Menu: {
    buildFromTemplate: (template: unknown[]) => {
      buildFromTemplateMock(template)
      return menuInstance
    }
  },
  MenuItem: class {
    constructor(opts: unknown) {
      menuItemCtor(opts)
    }
  },
  Notification: class {
    constructor() {}
    on(): this { return this }
    show(): void { showMock() }
  },
  nativeImage: {
    createFromPath: (p: string) => ({ path: p, setTemplateImage: setTemplateImageMock })
  },
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => ''),
    hide: vi.fn()
  }
}))

import { TrayManager } from '../../src/main/tray-manager'

describe('TrayManager', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tray-test-'))
    trayInstance.setToolTip.mockClear()
    trayInstance.setContextMenu.mockClear()
    trayInstance.on.mockClear()
    trayInstance.destroy.mockClear()
    buildFromTemplateMock.mockClear()
    menuItemCtor.mockClear()
    showMock.mockClear()
    hideMock.mockClear()
    restoreMock.mockClear()
    focusMock.mockClear()
    setTemplateImageMock.mockClear()
    trayCtor.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function fakeWindow(visible = false) {
    return {
      isVisible: vi.fn(() => visible),
      isMinimized: vi.fn(() => false),
      show: showMock,
      hide: hideMock,
      restore: restoreMock,
      focus: focusMock
    }
  }

  function captureMenu(): Array<Record<string, unknown>> {
    const template = buildFromTemplateMock.mock.calls[0][0] as Array<Record<string, unknown>>
    return template
  }

  it('creates a tray with tooltip and a context menu containing Show and Exit', () => {
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => null,
      onQuit: () => {}
    })
    expect(manager).not.toBeNull()
    expect(trayCtor).toHaveBeenCalledTimes(1)
    expect(trayInstance.setToolTip).toHaveBeenCalledWith('Meow Coding')
    expect(trayInstance.setContextMenu).toHaveBeenCalledTimes(1)
    const template = captureMenu()
    expect(template.map(t => t.label)).toContain('Show Meow Coding')
    expect(template.map(t => t.label)).toContain('Exit')
    expect(template.some(t => t.type === 'separator')).toBe(true)
  })

  it('shows and focuses a hidden window on tray click', () => {
    const win = fakeWindow(false)
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => win as never,
      onQuit: () => {}
    })!
    const clickHandler = trayInstance.on.mock.calls.find(([event]) => event === 'click')?.[1] as () => void
    clickHandler()
    expect(showMock).toHaveBeenCalledTimes(1)
    expect(focusMock).toHaveBeenCalledTimes(1)
    expect(hideMock).not.toHaveBeenCalled()
    void manager
  })

  it('hides a visible window on tray click', () => {
    const win = fakeWindow(true)
    TrayManager.create({
      userDataDir: dir,
      getWindow: () => win as never,
      onQuit: () => {}
    })
    const clickHandler = trayInstance.on.mock.calls.find(([event]) => event === 'click')?.[1] as () => void
    clickHandler()
    expect(hideMock).toHaveBeenCalledTimes(1)
    expect(showMock).not.toHaveBeenCalled()
  })

  it('shows the one-time notification only on the first hide', () => {
    const win = fakeWindow(true)
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => win as never,
      onQuit: () => {}
    })!
    manager.hideWindow()
    expect(showMock).toHaveBeenCalledTimes(1)
    expect(existsSync(path.join(dir, 'tray-notified'))).toBe(true)

    showMock.mockClear()
    manager.hideWindow()
    expect(showMock).not.toHaveBeenCalled()
  })

  it('stays silent when the notification flag already exists', () => {
    writeFileSync(path.join(dir, 'tray-notified'), '1')
    const win = fakeWindow(true)
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => win as never,
      onQuit: () => {}
    })!
    manager.hideWindow()
    expect(showMock).not.toHaveBeenCalled()
  })

  it('invokes the quit callback from the Exit menu item', () => {
    const onQuit = vi.fn()
    TrayManager.create({
      userDataDir: dir,
      getWindow: () => null,
      onQuit
    })
    const template = captureMenu()
    const exitItem = template.find(t => t.label === 'Exit') as { click?: () => void }
    exitItem?.click?.()
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  it('shows the window when the Show menu item is clicked', () => {
    const win = fakeWindow(false)
    TrayManager.create({
      userDataDir: dir,
      getWindow: () => win as never,
      onQuit: () => {}
    })
    const template = captureMenu()
    const showItem = template.find(t => t.label === 'Show Meow Coding') as { click?: () => void }
    showItem?.click?.()
    expect(showMock).toHaveBeenCalledTimes(1)
    expect(focusMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when tray creation fails', () => {
    trayCtor.mockImplementationOnce(() => {
      throw new Error('no tray on this system')
    })
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => null,
      onQuit: () => {}
    })
    expect(manager).toBeNull()
  })

  it('dispose destroys the tray and clears the reference', () => {
    const manager = TrayManager.create({
      userDataDir: dir,
      getWindow: () => null,
      onQuit: () => {}
    })!
    manager.dispose()
    expect(trayInstance.destroy).toHaveBeenCalledTimes(1)
  })
})
