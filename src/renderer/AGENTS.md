# AGENTS.md — src/renderer

React renderer (không có quyền truy cập Node/Electron trực tiếp).

## Cấu trúc

- `index.html` + `src/main.tsx` — entry; render `<App>`; nếu thiếu `window.api` hiện fallback hướng
  dẫn (preload chưa nạp).
- `src/App.tsx` — trung tâm state: workspaces, templates, runtime đang mở; định nghĩa `PaneModel`
  (agent + state + git) cho từng pane.
- `src/components/` — `Sidebar`, `PaneGrid`, `Pane`, `PaneHeader`, `XtermHost`, `EmptyState`,
  `StatusBar`, `TitleBar`, `BackgroundPanel`, `AddProjectDialog`, `AddAgentDialog`, `UpdateDialog`,
  `BrowserDialog`, `InstallGuideDialog`, `chat/`, `settings/`.
- `src/styles.css` — dark theme coding (VSCode Dark+ palette: `#1e1e1e` editor, `#007acc` accent),
  spacing theo thang 4px, controls dùng kích thước Tailwind default. Font: UI sans (Segoe UI
  Variable/system-ui) cho mọi text, mono (JetBrains Mono) cho terminal/data/label code.

## Quy ước

- Mọi truy cập main qua `window.api` (kiểu `AgentApi` từ shared). Không import Node/electron.
- Output đến trước khi xterm mount → buffer trong `buffersRef` (App), flush khi `registerTerminal`
  được gọi. Đừng xóa bỏ cơ chế này.
- Input/resize: xterm `onData`/resize → `window.api.writeInput` / `window.api.resizePty` (qua props
  trong `Pane`).
- Grid + zoom: click pane để zoom full-window, `Esc` thoát (xử lý trong `PaneGrid`).
- Component dạng functional + hooks; khai báo interface `Props` trong cùng file.
- Label UI tiếng Anh. Dùng số liệu tabular-nums khi hiển thị.

## CSS — border-radius & phạm vi style

Bài học rút ra từ màn hình Git viewer (đừng lặp lại):

- **`src/styles.css` có rule toàn cục `* { border-radius: var(--radius) }`** — nó bo góc MỌI element
  trừ khi bị override rõ ràng. Khi muốn một khu vực "vuông" (không bo góc), đừng chỉ set
  `border-radius: 0` lên từng rule — sẽ sót (tab, panel, cell) và dễ viết sai cú pháp.
- **Pattern chuẩn cho một màn hình/popup muốn vuông góc:**
  ```css
  /* Đầu section: */
  .git-viewer * { border-radius: 0; }          /* vuông toàn bộ */
  .git-viewer .btn,
  .git-viewer .git-header-btn { border-radius: var(--radius-sm); }  /* chỉ giữ cho nút */
  ```
  Chỉ liệt kê những element THẬT SỰ cần bo góc (nút, input, dropdown content, option...).
- Trước khi sửa: kiểm tra xem element có đang bị rule `*` làm tròn không (`grep "border-radius"` +
  theo dõi class). Đừng giả định.
- Sửa CSS bằng python khi file dùng CRLF (edit tool sẽ không khớp chuỗi) — xem `tests/*.test.ts`,
  `styles.css` đều CRLF.

## Hiệu năng

Rút ra từ một buổi debug lag ô chat input thật (đo bằng Chromium trace qua CDP, không suy đoán):

- **Hạn chế animation không cần thiết**, nhất là trên phần tử cập nhật thường xuyên (scroll theo mỗi
  token stream, transition trên input đang gõ). Animation chạy trên UI thread; cộng dồn với re-render
  dày đặc (streaming, gõ phím liên tục) sẽ gây giật rõ rệt. Với các cập nhật lặp lại nhanh, dùng scroll
  tức thời (`scrollIntoView()` không `behavior: 'smooth'`); chỉ dùng smooth scroll cho hành động rời
  rạc, một lần (VD: có message mới xuất hiện hẳn, không phải mỗi delta).
- **List dài (chat feed, tool-call list) bắt buộc có `content-visibility: auto` trên từng row**
  (`.chat-msg`, `.tool-call`) + `contain-intrinsic-size` ước lượng. Đã đo thực tế: project có lịch sử
  ~250 item / ~3000 DOM node khiến MỖI keystroke trong ô chat kích hoạt một lần layout toàn trang
  (~39ms) — trình duyệt cần layout đồng bộ để định vị con trỏ nhập liệu (`TypingCommand::InsertText`),
  và layout đó lan ra toàn bộ DOM kể cả phần đã cuộn khỏi màn hình từ lâu nếu không được đánh dấu
  content-visibility. Thêm thuộc tính này giảm ~6-7 lần chi phí (39ms → 5.7ms/keystroke).
- **Input text field chính (chat input) dùng uncontrolled (ref) thay vì controlled
  (`value` + `onChange` + `setState`)**. `setState` mỗi keystroke ép React re-render dù nội dung không
  ảnh hưởng UI khác. Đọc `e.target.value` trực tiếp qua ref; chỉ `setState` khi có state phái sinh THỰC
  SỰ đổi (VD: mở/đóng menu lệnh "/"), và bail-out bằng cách trả về cùng object reference khi giá trị
  không đổi để React tự bỏ qua re-render.
- **Đừng tối ưu khi chưa đo.** `requestAnimationFrame`/`cancelAnimationFrame` KHÔNG miễn phí — từng thử
  dùng rAF để "tách" một phép check rẻ (so sánh string) ra khỏi input handler, kết quả CHẬM HƠN bản
  đồng bộ cũ vì rAF là lời gọi API trình duyệt thật, không phải no-op. Trước khi thêm bất kỳ tối ưu perf
  nào: đo bằng công cụ thật (CPU profile / Chromium trace qua CDP `Profiler`/`Tracing`, hoặc Event
  Timing API `processingStart`/`processingEnd`) — không suy đoán từ pattern quen thuộc rồi coi là xong.
- **Callback truyền xuống component đã `memo()`** (VD: `ChatPanel`, `FeedMessage`, `ToolCallCard`,
  `CommandMenuItem`) phải ổn định qua `useCallback` với dependency đúng — nếu không, mọi re-render của
  component cha (kể cả do state không liên quan, VD polling git status mỗi 5s) sẽ ép re-render lan
  xuống toàn bộ cây con. Row/item component nên nhận props dạng primitive, tránh nhận nguyên object cha
  đổi reference mỗi render, nếu không `memo()` mất tác dụng.

## Kiểm thử

- Chưa có unit test renderer; đảm bảo `npm run typecheck` pass và e2e smoke
  (`npm run build && npm run e2e`) không vỡ.
