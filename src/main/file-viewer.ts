import { BrowserWindow, shell } from 'electron'
import { getWindowChromeOptions } from './window-chrome'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileContentResult, FileViewerPayload } from '../shared/types'

export const TEXT_EXTENSIONS = [
  // Docs & markup
  'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'tex', 'typ', 'txt',
  'html', 'htm', 'xhtml', 'xml', 'svg', 'csv', 'tsv',
  // JS/TS
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  // Frontend frameworks & styles
  'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less', 'styl',
  // Data & config
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg',
  'properties', 'env', 'sql', 'graphql', 'gql', 'proto', 'prisma',
  // C family
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm', 'cs', 'csx',
  // JVM, mobile & desktop
  'java', 'kt', 'kts', 'scala', 'sc', 'groovy', 'gradle', 'swift', 'dart', 'xaml',
  // Scripting
  'py', 'pyi', 'pyw', 'rb', 'rake', 'php', 'pl', 'pm', 'lua', 'r', 'jl',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs',
  // Functional, systems & misc
  'go', 'rs', 'zig', 'nim', 'hs', 'ex', 'exs', 'erl', 'hrl',
  'clj', 'cljs', 'cljc', 'edn', 'fs', 'fsx', 'sol', 'vim', 'asm', 's',
  'f', 'f90', 'f95', 'pas', 'pp', 'cob', 'cbl', 'adb', 'ads',
  'log', 'gitignore', 'plist', 'ipynb', 'tf', 'tfvars', 'hcl', 'cmake', 'mk'
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
    // Match the main app: custom title bar + overlay so min/max/close blend
    // with the theme instead of drawing a native frame.
    ...getWindowChromeOptions(process.platform),
    // Hide the default File/Edit/View/Window menu bar; Alt still reveals it so
    // shortcuts (copy/paste) keep working.
    autoHideMenuBar: true,
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
