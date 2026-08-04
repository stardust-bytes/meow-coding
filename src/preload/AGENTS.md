# AGENTS.md — src/preload

- Expose `window.api` qua `contextBridge`; implement đúng interface `AgentApi` (`src/shared/ipc.ts`).
- Method gọi: `ipcRenderer.invoke(Channels.X, ...args)`. Event đăng ký qua helper `subscribe`, trả về
  hàm hủy để renderer gọi trong cleanup.
- **KHÔNG** expose `ipcRenderer` ra window; chỉ expose đúng tập method trong `AgentApi`.
- Không import thư viện Node ngoài `electron`.
- Khi thêm method/channel: cập nhật `AgentApi` (shared), handler main, và file này. Renderer dùng
  cùng kiểu `window.api` (khai báo trong `src/renderer/src/env.d.ts`) nên tự đồng bộ.
- Kiểm thử: `npm run typecheck` (đảm bảo đúng contract).
