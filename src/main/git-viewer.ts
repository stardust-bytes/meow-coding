import { BrowserWindow } from 'electron'
import { getWindowChromeOptions } from './window-chrome'
import path from 'node:path'

const viewerWindows = new Map<string, BrowserWindow>()

// One git viewer popup per project path; re-click focuses the existing window.
export function openGitViewer(projectPath: string, getMainWindow: () => BrowserWindow | null): void {
  const existing = viewerWindows.get(projectPath)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const mainWin = getMainWindow()
  if (!mainWin) return
  const base = mainWin.webContents.getURL().split('?')[0]
  // Independent window (no parent) so it has its own taskbar entry and a
  // native title bar, matching the FileViewer popup.
  const win = new BrowserWindow({
    width: 940,
    height: 700,
    title: `${path.basename(projectPath)} — Git`,
    backgroundColor: '#1e1e1e',
    // Match the main app: custom title bar + overlay so min/max/close blend
    // with the theme instead of drawing a native frame.
    ...getWindowChromeOptions(process.platform),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.loadURL(`${base}?git=${encodeURIComponent(projectPath)}`)
  win.on('closed', () => viewerWindows.delete(projectPath))
  viewerWindows.set(projectPath, win)
}
