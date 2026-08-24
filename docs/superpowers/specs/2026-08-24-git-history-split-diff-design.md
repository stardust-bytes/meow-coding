# Git History — Split File Diff with Resizable Panes — Design

Date: 2026-08-24
Status: Approved (approach B — reusable SplitPane component)

## Tóm tắt

Trong tab **History** của GitViewer popup, khi người dùng click một file thay đổi trong commit
(hoặc so sánh 2 commit), diff của file hiện **thay thế** danh sách file trong khung bên phải.
Yêu cầu: mở diff trong một **pane tách rời bên cạnh** danh sách file, và cho phép **kéo divider
để điều chỉnh kích thước** giữa các vùng.

## Hành vi người dùng

- Layout history tab thành 3 cột có thể kéo: `[commit list 340px] | [file list] | [diff pane]`.
- Click một file trong danh sách → diff (unified, dùng lại `GitDiffView` hiện có) mở ở pane bên
  phải; danh sách file vẫn hiển thị và dòng đang chọn được highlight.
- Click lại file đang chọn hoặc nút **Close (X)** trên header của diff pane → đóng pane, trở về
  trạng thái danh sách file chiếm hết phần bên phải.
- Cả hai divider (commit list ↔ file list, file list ↔ diff) đều kéo được bằng chuột.
- Clamp: mỗi pane ≥ 160px, không vượt quá ~80% chiều rộng tổng.
- Kích thước divider chỉ sống trong phiên popup hiện tại; mở lại popup dùng kích thước mặc định.
- Áp dụng chung cho cả ba luồng đang dùng chung khung diff hiện tại: diff 1 commit, compare 2
  commit, và file history (Back to commits).

## Component mới: `SplitPane`

File mới `src/renderer/src/components/SplitPane.tsx` — container dùng chung, tách rời khỏi git:

- Props: `children: [ReactNode, ReactNode]`, `initial` (phần trăm hoặc px), `min`, `max`, `orientation`
  (mặc định horizontal), `className`.
- Render: flex row + divider (grip) ở giữa. Kéo divider bằng pointer events (`pointerdown` trên
  grip → `setPointerCapture` → `pointermove` tính vị trí theo `clientX` → clamp → set width bằng
  inline style; thả chuột → kết thúc).
- Trong khi kéo: tắt `user-select`/`text-select` trên toàn pane để tránh select text lạ; cursor
  `col-resize` trên grip.
- Tái dùng được cho Changes/Blame hoặc nơi khác sau này.

## Thay đổi trong `GitHistoryTab`

- Khung diff hiện tại (danh sách file / diff thay thế nhau) được tách thành hai trạng thái rõ ràng:
  - **File list** — luôn hiển thị khi có diff result.
  - **Diff pane** — hiển thị khi `diffFile !== null`; header nhỏ (tên file + trạng thái A/M/D + nút
    Close) + `GitDiffView`.
- Bọc cụm bên phải bằng `SplitPane`:
  - Vùng ngoài cùng giữ nguyên `[commit list] | SplitPane(file list, diff)`; chia commit list/diff
    bằng divider thứ nhất (flex 340px như cũ nhưng kéo được).
  - Bên trong: divider thứ hai giữa file list và diff pane.
- `selectDiffFile`: mở (set `diffFile`); nếu click đúng file đang mở → đóng (set `null`).
- Nút Close trên diff pane → `setDiffFile(null)`.
- Reset `diffFile` khi đổi commit / so sánh / vào file history (giữ hành vi hiện tại).

## CSS

- `.git-history` giữ flex hiện có; thêm style cho `.split-pane`, `.split-grip` (hairline, hover
  highlight, `col-resize`), `.git-diff-header` (tên file + trạng thái + Close).
- Không đổi màu/kiểu diff hiện có; dòng được chọn trong file list dùng class `active` giống commit row.

## Phạm vi ngoài

- Không thêm API mới (main/preload/shared) — chỉ renderer.
- Không đổi tab Changes/Blame (SplitPane sẵn sàng tái dùng nhưng chưa áp dụng).
- Không lưu kích thước divider bền vững (localStorage) — ngoài phạm vi, có thể làm sau.

## Kiểm thử

- Unit test cho `SplitPane` (render 2 children, kéo divider cập nhật width, clamp min/max) —
  `tests/unit/split-pane.test.tsx`.
- `npm run typecheck` + `npm test` pass (không chạm main/preload nên không ảnh hưởng
  `ipc-contract.test.ts`).
