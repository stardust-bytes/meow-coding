# Meow Coding — Brainstorm: Nhóm tính năng giá trị cao từ opencode

Ngày: 2026-08-05 · Trạng thái: chờ duyệt · Bước: brainstorm (trước spec)

## Mục tiêu

Chọn và khoanh phạm vi các tính năng từ nhóm "giá trị cao" (xem `notes/2026-08-05-opencode-feature-diff.md`)
để mang sang meow-coding, phù hợp bản chất **desktop multi-agent manager** (không phải CLI/TUI).

## Các ứng viên & đánh giá nhanh

### 1. Slash commands + prompt templates
- **Giá trị**: cao — user hay dùng `/init`, `/review`; mở ra hệ thống custom command.
- **Chi phí**: vừa — cần `commands` store + resolver template + IPC + UI input (gõ `/` autocomplete).
- **Rủi ro**: phạm vi dễ phình; nên bắt đầu bằng 2 built-in (`/init`, `/review`) + custom command từ file/folder.
- **Câu hỏi brainstorm**: lưu commands ở đâu (userData hay project `.meow/commands`)? Có cần `$1..$N`/`@path` ngay không?

### 2. Undo/redo + snapshot history UI
- **Giá trị**: rất cao — coding agent không undo được là gap khó chịu nhất; snapshot đã có sẵn.
- **Chi phí**: vừa — snapshot hiện lưu JSON map file→content, đủ để revert từng bước; cần thêm UI nút Undo/Redo + lịch sử.
- **Rủi ro**: snapshot hiện chỉ giữ 1 bản mới nhất (overwrite), cần đổi thành stack/lịch sử. Migration cần thận trọng.
- **Câu hỏi brainstorm**: giữ lịch sử theo turn hay theo message? Giới hạn dung lượng?

### 3. Cost/usage tracking + stats
- **Giá trị**: trung-cao — hiển thị cost/token theo session/model.
- **Chi phí**: thấp-vừa — đã có token từ `done` event; cần lưu cost + UI.
- **Rủi ro**: nguồn giá từ models.dev `cost` (đã có trong catalog limits path) — offline fallback cần chốt.
- **Câu hỏi brainstorm**: hiển thị cost ở đâu (status bar / per-session / settings)? Cần chart không?

### 4. LSP + diagnostics
- **Giá trị**: rất cao về chất lượng code (write/edit báo lỗi).
- **Chi phí**: cao nhất nhóm — cần spawn LSP server (38 languages), quản lý client, tích hợp edit pipeline.
- **Rủi ro**: phạm vi lớn; Windows path, server binary (typescript-language-server...), timeout.
- **Câu hỏi brainstorm**: bắt đầu chỉ với 1-2 server phổ biến (typescript, eslint)? Giai đoạn 1 chỉ diagnostics cho file đang sửa?

### 5. File watcher / auto-context
- **Giá trị**: trung-bình cho native agent (biết file nào thay đổi giữa các turn).
- **Chi phí**: thấp-vừa — `@parcel/watcher` native module (cần rebuild Electron) hoặc `fs.watch` thuần.
- **Rủi ro**: `@parcel/watcher` cần rebuild như node-pty; dùng `fs.watch` để tránh dependency.
- **Câu hỏi brainstorm**: auto-context thật sự cần hay chỉ là "dirty file list" đưa vào system prompt?

### 6. Tool output truncation service
- **Giá trị**: vừa — giảm token lãng phí, giữ full output có thể đọc lại.
- **Chi phí**: thấp — ghi output > ngưỡng ra file trong userData, gửi head/tail preview.
- **Rủi ro**: thấp.
- **Câu hỏi brainstorm**: cần tool `read` đọc lại phần bị truncate không?

### 7. Session title qua LLM + rename
- **Giá trị**: vừa — title đẹp hơn, user tự đặt tên.
- **Chi phí**: thấp — thêm 1 LLM call nhỏ (hoặc heuristic tốt hơn) + UI rename.
- **Rủi ro**: LLM title tốn thêm 1 request; có thể để heuristic mặc định.
- **Câu hỏi brainstorm**: rename thủ công hay auto-LLM? Cả hai?

### 8. Compaction auto-continue + prune
- **Giá trị**: trung-bình — sau compact tự tiếp tục turn; prune bớt output tool cũ.
- **Chi phí**: thấp — kế thừa luồng compaction hiện có.
- **Rủi ro**: auto-continue dễ lặp vô hạn nếu không giới hạn số lần compact/turn.
- **Câu hỏi brainstorm**: giới hạn auto-continue thế nào?

## Đề xuất phân nhóm triển khai

- **Nhóm A (nhanh, ít rủi ro, tác động rõ)**: (2) undo/redo + snapshot history, (6) tool truncation service, (8) compaction auto-continue+prune, (7) rename title.
- **Nhóm B (vừa, đòi hỏi spec kỹ)**: (1) slash commands, (3) cost/stats, (5) file watcher.
- **Nhóm C (lớn, làm sau hoặc riêng)**: (4) LSP + diagnostics.

## Quyết định từ user (2026-08-05)

1. **Làm cả 3 nhóm** (A: undo/redo+snapshot, tool truncation, compaction auto-continue+prune, rename title;
   B: slash commands, cost/stats, file watcher; C: LSP + diagnostics).
2. **Bám sát opencode**, nhưng **bỏ qua các slash command mang tính CLI/settings cho desktop** — tức:
   - Làm custom commands + template variables (`$1..$N`, `$ARGUMENTS`, `@path`, `` !`cmd` ``), built-in `/init` `/review`.
   - KHÔNG làm các command thuần CLI như `upgrade`, `uninstall`, `db`, `debug`, `serve`, `attach`, `acp`, `pr`, `generate`.
3. Thứ tự triển khai theo nhóm A → B → C.
