import { BrowserWindow, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileContentResult, FileViewerPayload } from '../shared/types'

export const TEXT_EXTENSIONS = [
  'md', 'markdown', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml', 'yml',
  'css', 'scss', 'html', 'htm', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp',
  'go', 'rs', 'rb', 'php', 'sh', 'bat', 'cmd', 'ps1', 'toml', 'ini', 'conf',
  'cfg', 'log', 'xml', 'svg', 'csv', 'sql', 'env', 'gitignore'
]

// Extensions that need a dedicated OS app (never shown in the viewer).
const BINARY_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar',
  'gz', 'exe', 'dll', 'so', 'dylib', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
  'bmp', 'mp3', 'mp4', 'avi', 'mov', 'woff', 'woff2', 'ttf', 'otf'
]

export const MAX_VIEWER_BYTES = 5 * 1024 * 1024

export function extOf(filePath: string): string {
  const base = path.basename(filePath).toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1)
}

/** true = known text; false = known binary; null = unknown (probe content) */
export function isTextPath(filePath: string): boolean | null {
  const ext = extOf(filePath)
  if (ext === '') return true // Dockerfile, Makefile, LICENSE...
  if (TEXT_EXTENSIONS.includes(ext)) return true
  if (BINARY_EXTENSIONS.includes(ext)) return false
  return null
}

export function looksLikeBinaryContent(content: string): boolean {
  return content.includes('\u0000')
}

const viewerWindows = new Map<string, BrowserWindow>()

// One popup per absolute path; re-click focuses the existing window.
export function openFileViewer(payload: FileViewerPayload, getMainWindow: () => BrowserWindow | null): void {
  const abs = path.resolve(payload.root, payload.path)
  const existing = viewerWindows.get(abs)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const mainWin = getMainWindow()
  if (!mainWin) return
  const base = mainWin.webContents.getURL().split('?')[0]
  // No `parent`: a child window minimizes into the parent's corner on Windows
  // and has no taskbar entry. An independent window minimizes to the taskbar
  // with a native title bar (min/max/close) and hover preview.
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: path.basename(abs),
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.loadURL(`${base}?file=${encodeURIComponent(abs)}&root=${encodeURIComponent(payload.root)}`)
  win.on('closed', () => viewerWindows.delete(abs))
  viewerWindows.set(abs, win)
}

export async function readFileContent(absPath: string): Promise<FileContentResult> {
  let st
  try {
    st = await stat(absPath)
  } catch {
    throw new Error(`Không tìm thấy file: ${absPath}`)
  }
  if (st.size > MAX_VIEWER_BYTES) {
    throw new Error('File quá lớn để xem trực tiếp (tối đa 5MB)')
  }
  const buf = await readFile(absPath)
  const content = buf.toString('utf8')
  if (looksLikeBinaryContent(content)) {
    throw new Error('File binary không xem trực tiếp được — sẽ mở bằng ứng dụng hệ điều hành')
  }
  return { path: absPath, ext: extOf(absPath), content }
}

/** Open non-text files with the OS default app. */
export async function openWithSystemApp(absPath: string): Promise<void> {
  const err = await shell.openPath(absPath)
  if (err) console.error('[meow] open file failed:', err)
}
