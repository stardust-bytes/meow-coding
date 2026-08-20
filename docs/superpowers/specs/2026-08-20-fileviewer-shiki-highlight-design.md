# FileViewer Syntax Highlighting (Shiki) — Design

Ngày: 2026-08-20
Trạng thái: Approved

## Vấn đề

Popup FileViewer hiển thị code dạng `<pre>` plain text, không có màu. Người dùng muốn
tô màu syntax chuẩn **giống VS Code** cho file mở trong popup (tsx, java, vue, ...).

## Phạm vi

- Chỉ popup FileViewer (cửa sổ `?file=` riêng). Không đổi chat bubble / markdown.
- Chỉ highlight (màu token), không phải full editor (line numbers, find, fold...).

## Giải pháp: Shiki renderer-side, lazy grammar, theme VS Code Dark+

### Dependency

- `shiki@^4` (bundle core + `@shikijs/langs` + `@shikijs/themes`).
- Engine Oniguruma WASM: `createOnigurumaEngine(() => import('shiki/wasm'))` — đúng
  TextMate grammar như VS Code.
- Theme **`dark-plus`** = VS Code Dark+ chính gốc.

### Render (`src/renderer/src/components/chat/highlight.ts` — module mới)

Singleton, lazy:
- `getHighlighter()` — `createHighlighter` chỉ khởi tạo lần đầu khi có file code.
- `highlightCode(content, ext): Promise<string>`:
  - Map ext → lang qua `bundledLanguages` (tsx→tsx, java→java, vue→vue, ...).
  - Không có grammar → fallback escape + `<pre>` plain (như hiện tại).
  - Lỗi wasm/grammar → catch, fallback plain, không crash popup.
- `isHighlightable(ext): boolean` — ext có trong grammar hay không (để UI quyết định
  hiển thị nút toggle).

### FileViewer (`src/renderer/src/components/FileViewer.tsx`)

- Giữ luồng hiện tại: `.md` → MarkdownText (raw toggle như cũ); còn lại → highlight.
- Thêm state `raw` cho file code: toolbar có nút **Highlighted / Raw**.
- Render: `<pre class="viewer-pre"><code class="viewer-code" dangerouslySetInnerHTML=html />`.

### CSP (`src/renderer/index.html`)

- `script-src 'self' 'wasm-unsafe-eval'` — WASM engine cần.

### Styles (`styles.css`)

- `.viewer-code` wrapper: nền `#1e1e1e` (VS Code Dark+), padding 14px 16px,
  `overflow-x: auto`, `display: block`, font mono giữ nguyên.
- `.viewer-pre` plain giữ nguyên (fallback).
- Shiki sinh inline styles token → không cần theme CSS.

### Bundle

- Grammar lazy: mở `.ts` không kéo grammar `.java`.
- shiki core + wasm chỉ nạp vào bundle popup khi cần (dynamic import từ renderer
  bundle chung — Vite sẽ tách chunk, không phình main chat bundle đáng kể vì
  dynamic import → code-split riêng).

### Fallback

- Không grammar / lỗi → plain `<pre>` như hiện tại.
- Lỗi tải → không crash popup.

## Kiểm thử

- Unit test `highlight.ts`:
  - `mapExtToLang`: tsx/java/vue/ts/js/... → lang đúng; `xyz` → undefined.
  - Fallback: `highlightCode` không throw khi grammar lỗi.
- Typecheck + toàn bộ `npm test`.
- Rebuild `npm run build`, verify bundle có shiki chunk + CSP mới.

## Không làm (out of scope)

- Highlight trong chat bubble / markdown.
- Monaco / editor features.
- Light theme.
