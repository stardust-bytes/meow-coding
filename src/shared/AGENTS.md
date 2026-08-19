# AGENTS.md — src/shared

Hợp đồng dùng chung giữa main / preload / renderer.

- `types.ts` — data models thuần (Template, Workspace, AgentConfig, AgentState, GitStatus, ...).
  Chỉ JSON-serializable: **không** class, không function, không import Node/Electron.
- `ipc.ts` — `Channels` (mọi channel string) + `AgentApi` (interface API) + kiểu event payload
  (`PtyDataEvent`, `AgentStateEvent`, `GitStatusEvent`).
- `browser-types.ts` — types riêng cho browser bridge (pairing, snapshot).
- `text.ts` — helper text thuần (append stream delta, ...).
- `usage.ts` — helper tính context/token usage thuần.

## Quy ước

- **KHÔNG** hardcode channel string ở nơi khác; chỉ dùng `Channels`.
- Đổi contract phải cập nhật đồng bộ 4 chỗ: handler main (`src/main/index.ts`), preload
  (`src/preload/index.ts`), renderer (`window.api`), và test `tests/unit/ipc-contract.test.ts`.
- Thêm event push mới: thêm channel `Event*` + interface payload + method subscribe trong `AgentApi`,
  rồi triển khai trong preload và forward trong main.
- File ở đây được dùng cho cả build main, preload, renderer và test → không kéo dependency bên ngoài.
