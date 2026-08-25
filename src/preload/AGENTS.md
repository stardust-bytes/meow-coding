# AGENTS.md — src/preload

- Expose `window.api` via `contextBridge`; implement the `AgentApi` interface correctly (`src/shared/ipc.ts`).
- Method calls: `ipcRenderer.invoke(Channels.X, ...args)`. Event subscriptions use the `subscribe` helper, which returns
  a cleanup function for the renderer to call during teardown.
- **DO NOT** expose `ipcRenderer` to the window; only expose the exact set of methods defined in `AgentApi`.
- Do not import any Node libraries other than `electron`.
- When adding a method/channel: update `AgentApi` (shared), the main handler, and this file. The renderer uses
  the same `window.api` type (declared in `src/renderer/src/env.d.ts`) so it stays in sync automatically.
- Testing: `npm run typecheck` (ensures the contract is correct).