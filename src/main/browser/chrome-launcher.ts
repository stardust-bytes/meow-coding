import { shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Channels } from '../../shared/ipc'
import { resolveChromeExecutablePath } from '../chatgpt-web/browser-login'

export interface BrowserLauncherDeps {
  getWindow?: () => BrowserWindow | null
  extensionDir: string
}

export interface BrowserLauncher {
  openChrome(): Promise<void>
  openExtensionFolder(): Promise<void>
  showInstallGuide(): Promise<void>
}

export function createChromeLauncher(deps: BrowserLauncherDeps): BrowserLauncher {
  const win = (): BrowserWindow | null => deps.getWindow?.() ?? null

  return {
    async openChrome() {
      const executablePath = resolveChromeExecutablePath({
        platform: process.platform,
        exists: existsSync
      })
      if (executablePath) {
        spawn(executablePath, ['chrome://extensions'], {
          detached: true,
          stdio: 'ignore'
        }).unref()
        return
      }
      await shell.openExternal('chrome://extensions')
    },
    async openExtensionFolder() {
      await shell.openPath(deps.extensionDir)
    },
    async showInstallGuide() {
      // In-app guide popup: push an event so the renderer opens its own dialog
      // instead of a native OS message box.
      win()?.webContents.send(Channels.EventBrowserOpenInstallGuide, { extensionDir: deps.extensionDir })
    }
  }
}

// Always re-syncs rather than gating on manifest version: a version-string
// comparison silently stops propagating any source change (e.g. new icon
// assets) to an already-installed copy whenever a commit forgets to bump
// the extension's manifest version. cpSync is cheap and local, so there is
// no real cost to just doing this on every launch.
export function ensureExtensionInstalled(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) return
  mkdirSync(targetDir, { recursive: true })
  cpSync(sourceDir, targetDir, { recursive: true })
}
