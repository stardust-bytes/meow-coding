# File Viewer Popup — Design Spec

Date: 2026-08-20
Status: Approved (user: ok)

## Problem

Khi agent (Meow agent / opencode / Claude Code...) trả lời trong chat, các đường dẫn
file — dạng markdown link `[text](path)` hoặc inline code `` `path` `` — chỉ hiển thị
dạng text thường, không mở xem được. Người dùng muốn bấm vào path để mở file dạng
text (md, txt, ts, json...) trong một cửa sổ popup riêng của Meow với markdown được
render (cho `.md`) hoặc text thô (cho text khác).

## Scope

- **Trigger duy nhất:** đường dẫn file xuất hiện trong tin nhắn chat (agent output),
  dạng markdown link tường minh `[text](href)` hoặc inline code `` `path` ``.
- Không xử lý: tool-call cards, trace panel, @file mentions trong ô gõ lệnh, danh
  sách file gần đây. (Có thể làm sau; spec này không bao gồm.)

## Requirements

1. Bấm vào path (markdown link hoặc inline code) trong chat → mở popup.
2. Popup là **cửa sổ OS riêng** (BrowserWindow), không phải modal trong app.
3. File text → popup hiển thị nội dung: `.md` render markdown, text khác hiển thị
   dạng text thô (`<pre>` mono).
4. File cần app riêng (pdf, docx, xlsx, zip, ảnh, binary...) → không mở popup, dùng
   `shell.openPath` mở bằng app mặc định hệ điều hành.
5. Popup có toolbar: path đầy đủ + 4 hành động: **Open in VS Code**, **Reveal in
   Folder**, **Copy**, **Raw/Markdown** (toggle chỉ hiển thị cho `.md`).
6. Đóng popup: nút Close hoặc phím Escape.
7. Mở lại cùng một file khi popup đã mở → focus cửa sổ cũ, không mở trùng.
8. Security: renderer không đụng fs; mọi đọc file đi qua main process qua IPC.
9. Thông báo lỗi từ main dùng tiếng Việt, prefix `[meow]` (đúng convention AGENTS.md).

## Design

### 1. Chat render (renderer)

`src/renderer/src/components/chat/MarkdownText.tsx`:

- Dùng custom renderer của `marked`:
  - **Markdown link** `[text](href)`: nếu `href` trỏ tới file local (bắt đầu `./`,
    `../`, `/`, `\`, drive Windows như `C:\`, hoặc đuôi file quen thuộc) → render
    `<a data-file data-path="...">`. Link http(s) giữ nguyên (mở external như hiện tại).
  - **Inline code** `` `path` ``: nếu nội dung khớp pattern path + đuôi file text →
    render `<span class="chat-file-link" data-path="...">` clickable.
- `MarkdownText` nhận thêm prop `onOpenFile?: (path: string) => void`; click handler
  trên container (delegation) gọi callback.
- `ChatPanel` đã có `cwd` của agent → resolve path tương đối theo `cwd` trước khi gọi
  `window.api.openFile({ path, root: cwd })`.
- File path absolute được phép (user tự click); không chặn.

### 2. IPC contract (shared)

Thêm vào `src/shared/ipc.ts` (chỉ dùng `Channels`, không hardcode string):

```ts
FileOpen: 'file:open',            // renderer → main: yêu cầu mở popup hoặc openPath
FileViewerGetContent: 'file-viewer:get-content',  // popup → main: đọc nội dung
FileViewerOpenInEditor: 'file-viewer:open-in-editor',
FileViewerShowInFolder: 'file-viewer:show-in-folder',
```

Thêm type mới trong `src/shared/types.ts`:

```ts
interface FileViewerPayload {
  path: string        // absolute path đã resolve
  root: string        // cwd của agent (để resolve relative)
}
interface FileContentResult {
  path: string
  ext: string         // 'md' | 'txt' | ...
  content: string
}
```

`src/preload/index.ts`: expose `window.api.openFile(payload)`,
`getFileContent(path)`, `openFileInEditor(path)`, `showFileInFolder(path)`.
Cập nhật `AgentApi` type tương ứng.

### 3. Main process

`src/main/index.ts`:

- **`FileOpen`**: nhận `{ path, root }`.
  - Resolve: `const abs = path.resolve(root, relOrAbs)` — dùng `path.resolve` cho cả
    path tuyệt đối lẫn tương đối.
  - Không tồn tại → `Notification` tiếng Việt: `[meow] Không tìm thấy file: <path>`.
  - Là text file (đuôi thuộc danh sách text, hoặc không đuôi/đuôi lạ → đọc thử, phát
    hiện NUL byte = binary) → mở popup (bên dưới).
  - Không phải text (pdf/docx/xlsx/zip/ảnh...) → `shell.openPath(abs)`.
- **Popup manager**: `Map<string, BrowserWindow>` (key = absolute path).
  - Đã tồn tại → `win.focus()`.
  - Chưa → `new BrowserWindow({ width: 900, height: 700, parent: mainWin, dark
    theme, backgroundColor khớp app })`, load URL
    `${mainWin.webContents.getURL().split('?')[0]}?file=${encodeURIComponent(abs)}&root=${encodeURIComponent(root)}`
    (cùng bundle render, không cần entry riêng).
  - `closed` → xoá khỏi map.
- **`FileViewerGetContent`**: `fs.readFile` với giới hạn ~5MB (quá → trả lỗi
  `[meow] File quá lớn để xem trực tiếp`). Trả `FileContentResult`.
- **`FileViewerOpenInEditor`**: dùng lại `openInEditor()` có sẵn.
- **`FileViewerShowInFolder`**: `shell.showItemInFolder(path)`.
- Ngoài ra không thay đổi gì khác ở main.

### 4. Renderer — route tới FileViewer

`src/renderer/src/main.tsx` / `App.tsx`:

- Kiểm tra `new URLSearchParams(window.location.search).get('file')`.
- Có → render thẳng `<FileViewer path root/>` (không mount app chính).
- Không → render app như cũ.

### 5. FileViewer component

`src/renderer/src/components/FileViewer.tsx` (mới):

- `useEffect` mount → `window.api.getFileContent(path)`.
- Trạng thái: loading / error (hiển thị message từ main) / loaded.
- Toolbar:
  - Trái: path đầy đủ (mono, wrap).
  - Phải: buttons **Open in VS Code**, **Reveal in Folder**, **Copy**, **Raw/Markdown**
    (toggle, chỉ khi `.md`), **Close**.
- Nội dung:
  - `.md` → `MarkdownText` (tái dùng render có sẵn; các link trong file cũng bấm mở
    được — truyền `onOpenFile`).
  - Text khác → `<pre className="viewer-pre">` mono, wrap, scroll.
- Copy → `navigator.clipboard.writeText(content)` (toàn bộ nội dung).
- Escape / nút Close → `window.close()`.
- Dark theme: style mới trong `src/renderer/src/styles.css`, dùng các CSS variables
  có sẵn của app (bg, text, accent) để khớp giao diện.

### 6. Danh sách extension

**Text:** `md, txt, ts, tsx, js, jsx, mjs, cjs, json, yaml, yml, css, scss, html,
htm, py, java, c, cpp, cc, h, hpp, go, rs, rb, php, sh, bat, cmd, ps1, toml, ini,
conf, cfg, log, xml, svg, csv, sql, env, gitignore, dockerfile`.

**Không text (openPath):** `pdf, doc, docx, xls, xlsx, ppt, pptx, zip, rar, 7z, tar,
gz, exe, dll, so, dylib, png, jpg, jpeg, gif, webp, ico, bmp, mp3, mp4, ...`.

Đuôi lạ/không đuôi: đọc thử; phát hiện NUL byte (`content.includes('\u0000')`) →
binary → `shell.openPath`.

## Files affected

- `src/shared/ipc.ts` — thêm 4 channels + type event.
- `src/shared/types.ts` — thêm `FileViewerPayload`, `FileContentResult`.
- `src/preload/index.ts` — expose 4 API mới.
- `src/main/index.ts` — handlers + popup manager + text/binary detection.
- `src/renderer/src/components/chat/MarkdownText.tsx` — custom renderer, clickable path.
- `src/renderer/src/components/chat/ChatPanel.tsx` — truyền `onOpenFile` + cwd.
- `src/renderer/src/main.tsx` + `App.tsx` — routing popup → `FileViewer`.
- `src/renderer/src/components/FileViewer.tsx` — mới.
- `src/renderer/src/styles.css` — style viewer.

## Out of scope

- Tool-call cards / trace panel clickable path.
- @file mentions trong chat input.
- Syntax highlighting trong viewer (chỉ mono text; có thể làm sau).
- Chế độ edit file trong viewer (chỉ xem).

## Testing

- `npm run typecheck` pass.
- `npm test` pass.
- Manual (dev):
  - Click markdown link `.md` → popup render markdown.
  - Click inline code path `.ts` → popup text thô.
  - Click lại file đang mở → focus cửa sổ cũ.
  - Click path `.pdf`/`.png` → mở app mặc định OS.
  - Click path không tồn tại → notification `[meow]`.
  - Nút Open in VS Code / Reveal in Folder / Copy / Raw-Markdown toggle.
  - Escape đóng popup.
- Không ảnh hưởng e2e (không đổi flow chính) → không bắt buộc `npm run e2e`.
