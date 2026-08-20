# File Viewer Popup — Implementation Plan

Spec: `docs/superpowers/specs/2026-08-20-file-viewer-popup-design.md`
Date: 2026-08-20

## Overview

Clicking a file path (markdown link `[text](path)` or inline code `` `path` ``) in
chat opens a file viewer: `.md` renders markdown, other text files show raw text, in
a separate BrowserWindow. Non-text files (pdf, docx, png, ...) open via the OS
default app. The viewer window reuses the renderer bundle routed by a `?file=` query
param.

## Architecture notes (from exploration)

- `MarkdownText.tsx` (renderer) already renders via `marked` + DOMPurify; add a
  custom renderer for `link` and `codespan` tokens and an `onOpenFile` callback.
- `ChatPanel` already receives `cwd` prop (agent working dir) and has a `FeedMessage`
  memoized component that renders `MarkdownText` — add `onOpenFile` prop pass-through.
- Main process (`src/main/index.ts`) owns all fs access. It has `openInEditor()`
  (spawns `code`), `shell` import, and a `win` module-level variable for the main
  window. A new module `file-viewer.ts` in `src/main` keeps helpers testable.
- Popup routing: popup loads same URL as main window + `?file=<abs>&root=<cwd>`;
  `main.tsx` checks query param and renders `FileViewer` instead of `App`.
- Tests are node-only (vitest `environment: 'node'`, include `tests/**/*.test.ts`);
  renderer components are NOT unit tested. Test the pure main-process helpers.
- Windows: `path.resolve` handles both `C:\...` and relative paths. Never spawn
  processes from renderer.

## Files

| File | Change |
|---|---|
| `src/main/file-viewer.ts` | **new** — text/binary detection + popup window manager |
| `src/main/index.ts` | register 4 IPC handlers, delegate to file-viewer |
| `src/shared/ipc.ts` | 4 new channels + `AgentApi` methods + event types |
| `src/shared/types.ts` | `FileViewerPayload`, `FileContentResult` |
| `src/preload/index.ts` | expose `openFile`, `getFileContent`, `openFileInEditor`, `showFileInFolder` |
| `src/renderer/src/components/FileViewer.tsx` | **new** — viewer window UI |
| `src/renderer/src/components/chat/MarkdownText.tsx` | custom renderer for clickable paths |
| `src/renderer/src/components/chat/ChatPanel.tsx` | pass `onOpenFile` + resolve with `cwd` |
| `src/renderer/src/main.tsx` | route `?file=` → FileViewer |
| `src/renderer/src/styles.css` | viewer styles |
| `tests/unit/file-viewer.test.ts` | **new** — detection helpers tests |

---

## Task 1: Shared types + IPC contract (TDD: pure, no tests needed here)

### 1a. `src/shared/types.ts`

Add after `FileSuggestion` (~line 348):

```ts
export interface FileViewerPayload {
  /** raw path from chat (relative or absolute) */
  path: string
  /** agent cwd used to resolve relative paths */
  root: string
}

export interface FileContentResult {
  path: string
  ext: string
  content: string
}
```

### 1b. `src/shared/ipc.ts`

In `Channels` object add:

```ts
FileOpen: 'file:open',
FileViewerGetContent: 'file-viewer:get-content',
FileViewerOpenInEditor: 'file-viewer:open-in-editor',
FileViewerShowInFolder: 'file-viewer:show-in-folder',
```

In `AgentApi` interface add:

```ts
openFile(payload: FileViewerPayload): Promise<void>
getFileContent(path: string): Promise<FileContentResult>
openFileInEditor(path: string): Promise<void>
showFileInFolder(path: string): Promise<void>
```

(Import `FileViewerPayload`, `FileContentResult` from `./types` — both already in the
import block at top of ipc.ts; add them to the existing `import type` list.)

---

## Task 2: Main-process file-viewer module (TDD)

### 2a. Write failing tests first: `tests/unit/file-viewer.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { isTextPath, looksLikeBinaryContent, TEXT_EXTENSIONS } from '../../src/main/file-viewer'

describe('isTextPath', () => {
  it('returns true for known text extensions', () => {
    expect(isTextPath('README.md')).toBe(true)
    expect(isTextPath('/a/b/app.ts')).toBe(true)
    expect(isTextPath('C:\\proj\\notes.txt')).toBe(true)
    expect(isTextPath('pkg.json')).toBe(true)
    expect(isTextPath('Dockerfile')).toBe(true)   // no ext
  })

  it('returns false for binary extensions', () => {
    expect(isTextPath('a.pdf')).toBe(false)
    expect(isTextPath('a.docx')).toBe(false)
    expect(isTextPath('a.png')).toBe(false)
    expect(isTextPath('a.zip')).toBe(false)
  })

  it('returns null (unknown) for unlisted extensions', () => {
    expect(isTextPath('a.xyz')).toBeNull()
  })
})

describe('looksLikeBinaryContent', () => {
  it('detects NUL bytes', () => {
    expect(looksLikeBinaryContent('a\u0000b')).toBe(true)
  })
  it('returns false for plain text', () => {
    expect(looksLikeBinaryContent('hello world\nline 2')).toBe(false)
  })
})

describe('TEXT_EXTENSIONS', () => {
  it('includes md, txt, ts, json, py', () => {
    for (const e of ['md', 'txt', 'ts', 'json', 'py']) expect(TEXT_EXTENSIONS).toContain(e)
  })
})
```

### 2b. Implement `src/main/file-viewer.ts`

```ts
import { BrowserWindow, Notification, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels, type FileContentResult, type FileViewerPayload } from '../shared/ipc'
// NOTE: Channels + types come from ../shared/ipc / ../shared/types

export const TEXT_EXTENSIONS = [
  'md', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml', 'yml',
  'css', 'scss', 'html', 'htm', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp',
  'go', 'rs', 'rb', 'php', 'sh', 'bat', 'cmd', 'ps1', 'toml', 'ini', 'conf',
  'cfg', 'log', 'xml', 'svg', 'csv', 'sql', 'env', 'gitignore'
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
  if (ext === '') return true // treat extension-less as text (Dockerfile, Makefile...)
  if (TEXT_EXTENSIONS.includes(ext)) return true
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar',
       'gz', 'exe', 'dll', 'so', 'dylib', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
       'bmp', 'mp3', 'mp4', 'avi', 'mov', 'woff', 'woff2', 'ttf', 'otf'].includes(ext)) {
    return false
  }
  return null
}

export function looksLikeBinaryContent(content: string): boolean {
  return content.includes('\u0000')
}

const viewerWindows = new Map<string, BrowserWindow>()

export function openFileViewer(payload: FileViewerPayload, getMainWindow: () => BrowserWindow | null): void {
  const abs = path.resolve(payload.root, payload.path)
  const existing = viewerWindows.get(abs)
  if (existing && !existing.isDestroyed()) { existing.focus(); return }
  const mainWin = getMainWindow()
  if (!mainWin) return
  const base = mainWin.webContents.getURL().split('?')[0]
  const win = new BrowserWindow({
    width: 900, height: 700, title: path.basename(abs),
    backgroundColor: '#1e1e1e', parent: mainWin,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  win.loadURL(`${base}?file=${encodeURIComponent(abs)}&root=${encodeURIComponent(payload.root)}`)
  win.on('closed', () => viewerWindows.delete(abs))
  viewerWindows.set(abs, win)
}

export async function readFileContent(absPath: string): Promise<FileContentResult> {
  const stat = await statOrNull(absPath)
  if (!stat) throw new Error(`Không tìm thấy file: ${absPath}`)
  if (stat.size > MAX_VIEWER_BYTES) throw new Error('File quá lớn để xem trực tiếp (tối đa 5MB)')
  const buf = await readFile(absPath)
  const content = buf.toString('utf8')
  if (looksLikeBinaryContent(content)) throw new Error('File binary không xem trực tiếp được — sẽ mở bằng ứng dụng hệ điều hành')
  return { path: absPath, ext: extOf(absPath), content }
}
```

Helpers needed: `statOrNull` (wrap `fs.stat` in try/catch, return `null`), imported
from `node:fs/promises`.

Notes:
- Module-level `viewerWindows` map keeps popup reuse (one window per absolute path).
- Errors thrown from `ipcMain.handle` reject the renderer promise; renderer displays
  `err.message`. Messages are Vietnamese (convention) — thrown inside `readFileContent`
  only.
- The "not found" case is handled in `index.ts` (see Task 3) so it can also show a
  Notification when triggered from chat (not from the viewer window itself).

### 2c. Run tests

```bash
npx vitest run tests/unit/file-viewer.test.ts
```

---

## Task 3: Main IPC handlers (`src/main/index.ts`)

### 3a. Imports

Add `Notification` to the `electron` import (line 1), `stat` from `node:fs/promises`:

```ts
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { stat } from 'node:fs/promises'
```

Import the new module:

```ts
import { isTextPath, openFileViewer, readFileContent } from './file-viewer'
```

### 3b. Handlers in `registerIpcHandlers()` (after `ProjectOpenFolder` handler ~line 497)

```ts
ipcMain.handle(Channels.FileOpen, async (_e, payload: FileViewerPayload) => {
  const abs = path.resolve(payload.root, payload.path)
  try {
    const st = await stat(abs)
    if (!st.isFile()) throw new Error(`Không phải file: ${payload.path}`)
  } catch {
    new Notification({ title: 'Meow Coding', body: `[meow] Không tìm thấy file: ${payload.path}` }).show()
    return
  }
  const kind = isTextPath(abs)
  if (kind === false) { await shell.openPath(abs); return }
  if (kind === true) { openFileViewer(payload, () => win); return }
  // unknown extension: probe content
  try {
    const { content } = await readFileContent(abs)
    if (looksLikeBinaryContent(content)) { await shell.openPath(abs); return }
  } catch {
    await shell.openPath(abs) // oversized/binary → OS app
    return
  }
  openFileViewer(payload, () => win)
})

ipcMain.handle(Channels.FileViewerGetContent, (_e, absPath: string) => readFileContent(absPath))

ipcMain.handle(Channels.FileViewerOpenInEditor, (_e, absPath: string) => openInEditor(absPath))

ipcMain.handle(Channels.FileViewerShowInFolder, (_e, absPath: string) => {
  shell.showItemInFolder(absPath)
})
```

(Import `looksLikeBinaryContent` too.)

`FileViewerPayload` type imported from `../shared/types` — add to the existing type
import list on line 24-ish.

---

## Task 4: Preload API (`src/preload/index.ts`)

Add to `const api: AgentApi = { ... }` (after `openFolder`):

```ts
openFile: (payload: FileViewerPayload) => ipcRenderer.invoke(Channels.FileOpen, payload),
getFileContent: (path: string) => ipcRenderer.invoke(Channels.FileViewerGetContent, path),
openFileInEditor: (path: string) => ipcRenderer.invoke(Channels.FileViewerOpenInEditor, path),
showFileInFolder: (path: string) => ipcRenderer.invoke(Channels.FileViewerShowInFolder, path),
```

Add `FileViewerPayload` to the `import type { ... } from '../shared/types'` line.

---

## Task 5: Viewer component (`src/renderer/src/components/FileViewer.tsx`)

New file:

```tsx
import { useCallback, useEffect, useState } from 'react'
import MarkdownText from './chat/MarkdownText'

interface Props { path: string; root: string }

export default function FileViewer({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.getFileContent(filePath)
      .then(r => { if (alive) { setContent(r.content); setRaw(false) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [filePath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copy = useCallback(async () => {
    if (content) await navigator.clipboard.writeText(content)
  }, [content])

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isMarkdown = ext === 'md' || ext === 'markdown'

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Markdown' : 'Raw'}
            </button>
          )}
          <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          <button className="btn small" onClick={() => void window.api.showFileInFolder(filePath)}>Reveal in Folder</button>
          <button className="btn small" onClick={() => void copy()} disabled={!content}>Copy</button>
          <button className="btn small" onClick={() => window.close()}>Close</button>
        </div>
      </div>
      <div className="viewer-body">
        {error ? (
          <div className="viewer-error">{error}</div>
        ) : content === null ? (
          <div className="viewer-loading">Loading…</div>
        ) : isMarkdown && !raw ? (
          <div className="viewer-md"><MarkdownText text={content} onOpenFile={openLinkedFile} /></div>
        ) : (
          <pre className="viewer-pre">{content}</pre>
        )}
      </div>
    </div>
  )
}
```

`window.api` typing: check `src/renderer/src/env.d.ts` — it declares `window.api` as
`AgentApi`; new methods are covered automatically once `AgentApi` gains them. If
`env.d.ts` uses a different shape, update it too.

---

## Task 6: Clickable paths in chat

### 6a. `src/renderer/src/components/chat/MarkdownText.tsx`

- Add prop `onOpenFile?: (path: string) => void`.
- Custom renderer:

```ts
const renderer = {
  link({ href, text }: { href: string; text: string }) {
    if (/^https?:/i.test(href)) return false // fall back to default rendering
    return `<a class="chat-file-link" href="#" data-file="${escapeAttr(href)}">${text}</a>`
  },
  codespan({ text }: { text: string }) {
    if (!/^\.{0,2}[\/\\]|^[A-Za-z]:[\\\/]/.test(text) && !/\.[A-Za-z0-9]{1,5}$/.test(text)) return false
    return `<span class="chat-file-link" data-file="${escapeAttr(text)}">${text}</span>`
  }
}
marked.use({ renderer })
```

Important: `marked.use` is global — but MarkdownText is the only consumer of marked in
the app, so it's safe. Alternatively pass `renderer` per-call: `marked.parse(src, { renderer, async: false })`. Prefer per-call options to avoid global mutation:

```ts
const html = marked.parse(src, { renderer: { link, codespan } as any, async: false })
```

Hmm — `marked.parse` options type accepts `RendererObject`? Use
`marked.use({ renderer })` at module scope once (simplest, and MarkdownText is the
sole marked consumer). Decide during implementation; both are acceptable, document
the choice in code comment.

- Add click delegation on the container div:

```tsx
const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')
  if (!el || !onOpenFile) return
  const p = el.getAttribute('data-file')
  if (p) { e.preventDefault(); onOpenFile(p) }
}
return <div className="chat-text chat-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
```

Helper `escapeAttr` — escape `"`, `&`, `<`, `>` (or reuse an existing escape if found).

Also: DOMPurify config — `data-file` attributes must survive sanitization. DOMPurify
default allowlist keeps `data-*` attributes, so `data-file` is fine. Verify at runtime
in Task 8.

### 6b. `src/renderer/src/components/chat/ChatPanel.tsx`

- `FeedMessage` gains `onOpenFile?: (p: string) => void` prop; pass to `MarkdownText`.
- In the `items.map` for `kind === 'message'`, pass `onOpenFile={openFile}`.
- Define near other callbacks:

```ts
const openFile = useCallback((p: string) => {
  void window.api.openFile({ path: p, root: cwd })
}, [cwd])
```

`cwd` is already a ChatPanel prop (`cwd={pane.agent.cwd}`).

---

## Task 7: Route popup to FileViewer (`src/renderer/src/main.tsx`)

```tsx
const params = new URLSearchParams(window.location.search)
const fileParam = params.get('file')
const rootParam = params.get('root') ?? ''

if (!window.api) { /* existing preload-missing branch */ }
else if (fileParam) {
  createRoot(rootEl).render(
    <React.StrictMode><FileViewer path={fileParam} root={rootParam} /></React.StrictMode>
  )
} else {
  createRoot(rootEl).render(<React.StrictMode><App /></React.StrictMode>)
}
```

Import `FileViewer`.

Note: URLSearchParams decodes `%2F` etc. automatically; `encodeURIComponent` on the
main side + `params.get` on the renderer side round-trips Windows paths with
backslashes correctly (`%5C` → `\`).

---

## Task 8: Styles (`src/renderer/src/styles.css`)

Append at end:

```css
.viewer { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }
.viewer-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); flex-wrap: wrap; }
.viewer-path { font-family: var(--font-mono, monospace); font-size: 12px; opacity: 0.85; flex: 1; min-width: 200px; overflow-wrap: anywhere; }
.viewer-actions { display: flex; gap: 6px; }
.viewer-body { flex: 1; overflow: auto; padding: 12px 16px; }
.viewer-md { max-width: 820px; }
.viewer-pre { white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono, monospace); font-size: 13px; line-height: 1.5; margin: 0; }
.viewer-error { color: var(--danger, #ff6b6b); }
.viewer-loading { opacity: 0.6; }
.chat-file-link { color: var(--accent); text-decoration: underline; cursor: pointer; }
.chat-file-link:hover { text-decoration: none; }
```

Check which CSS variables actually exist (`--bg`, `--text`, `--accent`, `--font-mono`)
in styles.css and use the real names; fallback values above are placeholders.

---

## Task 9: Verify

1. `npm run typecheck` — fix errors.
2. `npm test` — all pass (including new file-viewer tests).
3. Manual smoke in `npm run dev`:
   - Chat with Meow agent; ask it to write a `.md` file and mention path → click link →
     popup opens with rendered markdown.
   - Click inline-code path to a `.ts` file → popup with raw text.
   - Click again → same window focused, no duplicate.
   - Path to `.png`/`.pdf` → opens in OS app.
   - Path that doesn't exist → `[meow] Không tìm thấy file: ...` notification.
   - Toolbar buttons: Open in VS Code, Reveal in Folder, Copy, Raw/Markdown toggle.
   - Escape closes popup.
   - Links inside a rendered `.md` (relative to same root) open another popup.

## Commit strategy

Commit per task group with conventional messages:
- `feat(shared): file viewer IPC contract and types`
- `feat(main): file viewer popup window and content reading` (incl. tests)
- `feat(renderer): file viewer popup UI and clickable chat paths`
- Final: `feat: file viewer popup for md/text files`

## Out of scope (re-check)

- Tool-call cards, trace panel clickable paths, @file mentions — not in this plan.
- Syntax highlighting, edit mode — not in this plan.
