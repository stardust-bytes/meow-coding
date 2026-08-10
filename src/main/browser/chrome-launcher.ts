import { shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
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
      win()?.webContents.send(Channels.EventBrowserOpenInstallGuide)
    }
  }
}

export function ensureExtensionInstalled(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) return
  if (existsSync(targetDir) && versionOf(targetDir) === versionOf(sourceDir)) return
  mkdirSync(targetDir, { recursive: true })
  cpSync(sourceDir, targetDir, { recursive: true })
}

function versionOf(dir: string): string {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as { version?: string }
    return m.version ?? ''
  } catch {
    return ''
  }
}
