# Git History — Resizable Split File Diff — Implementation Plan

Date: 2026-08-24
Spec: `docs/superpowers/specs/2026-08-24-git-history-split-diff-design.md`

TDD. Mỗi task commit riêng. Sau mỗi task chạy `npm run typecheck`; cuối plan chạy `npm test`.

## Lưu ý môi trường (quyết định lệch spec nhỏ)

Vitest config hiện tại: `environment: 'node'`, include `tests/**/*.test.ts` (KHÔNG gồm `.tsx`,
không có jsdom/@testing-library). Vì vậy không viết test render component như spec gợi ý — thay vào
đó tách **logic thuần** (tính toán width/position khi kéo) thành hàm exported từ `SplitPane.tsx` và
test hàm đó trong node env (giống pattern `parseDiff.ts` + test thuần của repo). Component giữ mỏng.

## File structure

### Mới
| File | Trách nhiệm |
|---|---|
| `src/renderer/src/components/SplitPane.tsx` | Container 2 pane kéo được: `left` + `right` children, grip ở giữa. Xuất hàm thuần `clampPaneSize` + `computePaneWidth` để test. |
| `tests/unit/split-pane.test.ts` | Test thuần: clamp min/max/80%, tính width theo clientX. |

### Sửa
| File | Thay đổi |
|---|---|
| `src/renderer/src/components/git/GitHistoryTab.tsx` | Tách khung diff hiện tại thành 2 pane: file list (luôn hiện khi có diff) + diff pane (khi `diffFile`). Bọc `SplitPane` cả 2 divider. Thêm header diff (tên file + status + nút Close). Toggle khi click lại file đang chọn. |
| `src/renderer/src/styles.css` | Thêm `.split-pane`, `.split-grip`, `.git-diff-header`; bỏ `flex: 0 0 340px` cứng của `.git-history-list` (chuyển sang `initial` của SplitPane). |

## Task 1 — SplitPane component + logic thuần + test

`src/renderer/src/components/SplitPane.tsx`:

```tsx
import { useCallback, useRef, useState, type ReactNode } from 'react'

export interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  initial?: number      // px width của left pane (mặc định 340)
  min?: number          // mặc định 160
  maxRatio?: number     // left tối đa = maxRatio * chiều rộng container (mặc định 0.8)
  className?: string
}

// Logic thuần (export để test, không phụ thuộc DOM)
export function clampPaneSize(width: number, total: number, min: number, maxRatio: number): number {
  const max = Math.floor(total * maxRatio)
  return Math.min(Math.max(width, min), Math.max(min, max))
}

export function computePaneWidth(clientX: number, containerLeft: number, total: number, min: number, maxRatio: number): number {
  return clampPaneSize(clientX - containerLeft, total, min, maxRatio)
}
```

Component:
- Root: `<div className={'split-pane' + (className ? ' ' + className : '')} ref={containerRef} style={{ display: 'flex', ... }}>` — thực ra style qua CSS class, không inline.
- Left pane: `<div className="split-pane-left" style={{ width: leftWidth }}>{left}</div>` (flex-shrink 0).
- Grip: `<div className="split-grip" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />`.
- Right: `<div className="split-pane-right">{right}</div>` (flex 1, min-width 0).
- `leftWidth` state khởi tạo `initial` (đã clamp theo min). Kéo: `pointerdown` → `setPointerCapture(e.pointerId)` → `pointermove` đọc `containerRef.current.getBoundingClientRect()` → `computePaneWidth(e.clientX, rect.left, rect.width, min, maxRatio)` → set state. `pointerup` → release.
- Trong lúc kéo: thêm class `resizing` lên root (CSS tắt `user-select`) — dùng state `dragging` boolean.
- Refs cập nhật khi mất container (đơn giản: nếu chưa có container khi drag bắt đầu thì bỏ qua).

`tests/unit/split-pane.test.ts` (node env):
- `clampPaneSize` giữ nguyên width khi trong [min, 80%].
- Clamp dưới → min; clamp trên → `total*0.8`; khi `total` nhỏ (vd 200) và min 160 → max = max(min, floor(total*0.8)) nên không nhỏ hơn min.
- `computePaneWidth` = clientX - left, qua clamp.

## Task 2 — Wire vào GitHistoryTab

Trong `GitHistoryTab.tsx`:

1. **Trạng thái**: giữ nguyên `diffFile`, `diff`, `diffError`. Thêm helper:
   ```tsx
   const toggleDiffFile = useCallback((f: GitDiffFile) => {
     setDiffFile(prev => (prev && prev.path === f.path ? null : f))
   }, [])
   ```
   Đổi `renderFileRows` onClick từ `selectDiffFile` → `toggleDiffFile`; thêm class `active` khi `diffFile?.path === f.path`.

2. **Diff pane có header** (mới):
   ```tsx
   const fileDiffPane = diffFile ? (
     <div className="git-history-diff">
       <div className="git-diff-header">
         <span className={`git-change-status ${...}`}>A/M/D/R</span>
         <span className="git-diff-header-path" title={diffFile.path}>{diffFile.path}</span>
         <button className="git-diff-close" title="Close" aria-label="Close diff" onClick={() => setDiffFile(null)}>
           <X size={13} />
         </button>
       </div>
       <GitDiffView raw={diffFile.raw} />
     </div>
   ) : null
   ```
   Import `X` từ `lucide-react`.

3. **Tách `diffPane` cũ** thành:
   - `fileListPane`: nội dung `renderFileRows(diff.files)` (hoặc empty state) — luôn render khi `diff !== null`.
   - `diffPane` (giữ tên cũ cho placeholder/error):
     ```tsx
     const diffPane = diffError ? <error banner/> :
       diff === null ? <placeholder/> :
       fileDiffPane ? (
         <SplitPane left={fileListPane} right={fileDiffPane} initial={340} min={160} />
       ) : fileListPane
     ```
   Bỏ nhánh `diffFile ? ... : ...` cũ (thay thế bằng split).

4. **Outer split**: cả 2 chỗ render `.git-history` (main + fileHistory) đổi từ `{listPane}{diffPane}` thành:
   ```tsx
   <SplitPane left={listPane} right={diffPane} initial={340} min={160} />
   ```
   Trong fileHistory, `listPane` = `.git-history-filehistory` (giữ nguyên).

5. **Reset**: giữ nguyên các chỗ `setDiffFile(null)` hiện có (selectCommit, toggleCompare, openFileHistory, backToCommits) — chúng đã reset khi đổi commit/so sánh/file history.

## Task 3 — CSS

`src/renderer/src/styles.css`:

- `.split-pane { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }`
- `.split-pane-left { flex: 0 0 auto; min-width: 0; overflow: hidden; display: flex; }` (child tự scroll bên trong)
- `.split-pane-right { flex: 1; min-width: 0; overflow: hidden; display: flex; }`
- `.split-grip { flex: 0 0 7px; cursor: col-resize; background: transparent; }` + `:hover { background: var(--accent-dim); }` (giống `.right-panel-resizer`); khi `.split-pane.resizing` → `.split-grip { background: var(--accent-dim); }` và root `user-select: none`.
- `.git-history` giữ `display: flex` nhưng nội dung giờ là 1 SplitPane → thay bằng wrapper hoặc bỏ flex cũ: `.git-history { flex: 1; min-height: 0; }` (SplitPane tự flex). Kiểm tra `.git-history-diff { flex: 1; ... }` giữ nguyên (nằm trong pane right).
- `.git-history-list`, `.git-history-filehistory` bỏ `flex: 0 0 340px` (SplitPane quản lý width); giữ `overflow-y: auto; border-right: none` (divider thay thế border) — thử nghiệm: có thể giữ `border-right` nếu trông ổn, ưu tiên bỏ để divider đóng vai trò ranh giới.
- `.git-diff-header { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--hairline); font-family: var(--font-mono); font-size: var(--fs-xs); position: sticky; top: 0; background: var(--bg-panel); }` + `.git-diff-header-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }` + `.git-diff-close { ... button nhỏ, màu text-faint, hover text-strong }`.

## Task 4 — Verify

- `npm run typecheck` pass.
- `npm test` pass (không đụng main/preload → không ảnh hưởng ipc-contract).
- Smoke: `npm run dev` → mở Git popup → History → click commit → click file → diff mở bên cạnh, file list vẫn thấy, kéo 2 divider được, click lại file / nút Close đóng được; compare 2 commit + file history chạy đúng.

## Out of scope
- Không lưu kích thước divider (localStorage) — sau này.
- Không áp dụng SplitPane cho Changes/Blame tab.
