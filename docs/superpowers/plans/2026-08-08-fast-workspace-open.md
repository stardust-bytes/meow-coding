# Meow Coding — Fast workspace open (non-blocking) — Plan

**Goal:** Xoá delay khi mở project (pane view phải hiện ngay, không đợi backend). Đo được: lần mở đầu
485ms, mở lại 20-31ms (render ~36ms) — toàn bộ delay nằm ở IPC `openWorkspace` block trên init
(MCP sync + model catalog fetch) + spawn PTY tuần tự.

**Thay đổi:**

- `src/main/index.ts` `openWorkspace`: register native agent đồng bộ (rẻ, để chat mount đúng
  transcript), trả `runtimeFor` ngay, chạy `init` + `Promise.all(startAgent)` ở background qua
  `prepareWorkspace` (kèm catch để không crash).
- `src/main/meow-agent-manager.ts`:
  - `register(agent, force?)`: `force` cho phép rebuild runner sau khi tools sync (MCP/user), skip nếu
    turn đang chạy.
  - `init`: `register(agent, true)` để áp dụng tools/model limits mới.

**Kết quả đo (sau):** mở đầu 14ms, mở lại 4ms, render 22ms.

**Kiểm thử:** typecheck, `npm test`, `npm run build && npm run e2e` PASS.
