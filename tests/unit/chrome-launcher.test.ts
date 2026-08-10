import { describe, expect, it, vi } from 'vitest'
import { createChromeLauncher } from '../../src/main/browser/chrome-launcher'
import { Channels } from '../../src/shared/ipc'

describe('createChromeLauncher.showInstallGuide', () => {
  it('sends the extensionDir payload so the renderer can open the dialog', async () => {
    const send = vi.fn()
    const launcher = createChromeLauncher({
      getWindow: () => ({ webContents: { send } }) as never,
      extensionDir: 'C:\\Users\\test\\AppData\\Roaming\\meow-coding\\browser-extension'
    })

    await launcher.showInstallGuide()

    expect(send).toHaveBeenCalledWith(
      Channels.EventBrowserOpenInstallGuide,
      { extensionDir: 'C:\\Users\\test\\AppData\\Roaming\\meow-coding\\browser-extension' }
    )
  })

  it('does nothing when there is no window', async () => {
    const launcher = createChromeLauncher({ getWindow: () => null, extensionDir: '/x' })
    await expect(launcher.showInstallGuide()).resolves.toBeUndefined()
  })
})
