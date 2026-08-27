import { app, Menu, nativeImage, Notification, Tray } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

export interface TrayManagerOptions {
  userDataDir: string
  getWindow: () => BrowserWindow | null
  onQuit: () => void
}

export class TrayManager {
  private constructor(
    private tray: Tray,
    private getWindow: () => BrowserWindow | null,
    private onQuit: () => void,
    private userDataDir: string
  ) {}

  static create(opts: TrayManagerOptions): TrayManager | null {
    let image: string | Electron.NativeImage
    if (process.platform === 'darwin') {
      const native = nativeImage.createFromPath(TrayManager.iconPath())
      native.setTemplateImage(true)
      image = native
    } else {
      image = TrayManager.iconPath()
    }
    let tray: Tray
    try {
      tray = new Tray(image)
    } catch (err) {
      // No system tray (rare on headless/minimal Linux) — fall back to the
      // old behavior (close = quit) instead of trapping the user.
      console.error('[meow] tray creation failed:', err)
      return null
    }
    const manager = new TrayManager(tray, opts.getWindow, opts.onQuit, opts.userDataDir)
    tray.setToolTip('Meow Coding')
    tray.setContextMenu(Menu.buildFromTemplate(manager.menuTemplate()))
    tray.on('click', () => manager.toggleWindow())
    return manager
  }

  private static iconPath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'tray-icon.png')
      : path.join(app.getAppPath(), 'build', 'icons', '32x32.png')
  }

  private menuTemplate(): MenuItemConstructorOptions[] {
    return [
      { label: 'Show Meow Coding', click: () => this.showWindow() },
      { type: 'separator' },
      { label: 'Exit', click: () => this.onQuit() }
    ]
  }

  toggleWindow(): void {
    const win = this.getWindow()
    if (!win) return
    if (win.isVisible()) {
      // Tray click is an explicit user action — hide silently. The one-time
      // reminder only fires when the window is closed via the X button.
      win.hide()
      if (process.platform === 'darwin') app.hide()
    } else {
      this.showWindow()
    }
  }

  hideWindow(): void {
    const win = this.getWindow()
    if (win) {
      win.hide()
      if (process.platform === 'darwin') app.hide()
    }
    this.notifyOnce()
  }

  dispose(): void {
    this.tray.destroy()
  }

  private showWindow(): void {
    const win = this.getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  private notifyOnce(): void {
    const flag = path.join(this.userDataDir, 'tray-notified')
    if (existsSync(flag)) return
    const n = new Notification({
      title: 'Meow Coding',
      body: '[meow] Meow Coding is still running in the background. Click the tray icon to reopen it.'
    })
    n.on('click', () => this.showWindow())
    n.show()
    writeFileSync(flag, '1')
  }
}
