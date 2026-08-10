import { dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
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
        spawn(executablePath, ['--new-window', 'chrome://extensions'], {
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
      const buttons = ['Mở chrome://extensions', 'Mở thư mục extension', 'Đóng']
      const message =
        '[meow] Cài extension "Meow Browser Bridge" để agent điều khiển Chrome.\n\n' +
        '1. Nhấn "Mở chrome://extensions" (Chrome sẽ mở trang extension).\n' +
        '2. Bật Developer mode (góc phải trên).\n' +
        '3. Nhấn "Load unpacked" và chọn thư mục:\n' +
        `   ${deps.extensionDir}\n` +
        '4. Quay lại Meow, mở dialog Browser và nhấn "Ghép nối" để lấy mã,\n' +
        '   rồi nhập mã vào popup extension.\n\n' +
        'Extension chỉ kết nối tới Meow trên máy này (127.0.0.1) và yêu cầu mã ghép nối.'
      const opts = {
        type: 'info' as const,
        title: 'Meow Browser Bridge',
        message,
        buttons,
        defaultId: 0,
        cancelId: 2
      }
      const { response } = win()
        ? await dialog.showMessageBox(win()!, opts)
        : await dialog.showMessageBox(opts)
      if (response === 0) await shell.openExternal('chrome://extensions')
      else if (response === 1) await shell.openPath(deps.extensionDir)
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
