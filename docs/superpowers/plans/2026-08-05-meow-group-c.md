# Meow Coding — Group C: LSP + Diagnostics: Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhóm C — LSP client (typescript/eslint/biome đầu tiên), diagnostics sau write/edit/apply-patch, tool `lsp`.

**Trạng thái:** ✅ Đã thực thi (typecheck, 293 unit/integration tests, 6 e2e pass).

---

## 1. LSP client (`src/main/agent/lsp/manager.ts`, mới)

- Minimal LSP client qua stdio JSON-RPC (Content-Length framing), **không thêm dependency**.
- `LspClient { initialize(), didOpen(file, text), didChange(file, text), didSave(file), onDiagnostics(cb),
  definition/references/hover/documentSymbol(...), dispose() }`.
- Framing: gửi/nhận `Content-Length: N\r\n\r\n{json}`; `response` map theo id; `notification` →
  `publishDiagnostics` buffer.
- Server spec: `{ language, command, args, extensions, initOptions }`.

## 2. Server registry (`src/main/agent/lsp/servers.ts`, mới)

- `typescript` → `typescript-language-server --stdio` (ext: .ts/.tsx/.js/.jsx).
- `eslint` → `vscode-eslint-language-server --stdio` (ext: .js/.ts/.jsx/.tsx).
- `biome` → `@biomejs/biome lsp-proxy` (ext: .js/.ts/.json...).
- `LspManager`: per-workspace clients; `ensure(projectPath, filePath)` spawn theo ext (chỉ khi có binary,
  `which`/`existsSync`); đóng khi workspace đóng.

## 3. Diagnostics injection (tools)

- `write.ts`, `edit.ts`, `apply-patch.ts`: sau khi ghi, gọi `diagnosticsFor(file)` (didOpen+didChange+didSave,
  chờ `publishDiagnostics` timeout `lsp.diagnosticsTimeoutMs` default 3000) → thêm vào output:
  `[LSP] <path>:<line>:<col>: <message>` (tối đa 5).
- Config `lsp: { enabled: true, servers: {...}, diagnosticsTimeoutMs: 3000 }` (meow.json).

## 4. Tool `lsp` (`src/main/agent/tools/lsp.ts`, mới)

- `lsp` tool: `operation` (goToDefinition|findReferences|hover|documentSymbol|workspaceSymbol), `file_path`, `query`.
- Chạy qua manager; trả text JSON gọn; server không sẵn sàng → error.

## 5. Manager wiring

- `meow-agent-manager.ts`: `lsp = new LspManager()`; `ensure` khi native agent cần; cung cấp `lsp` tool
  (thêm vào `runnerTools`); đóng khi agent removed.
- `index.ts`: lifecycle theo workspace (cùng file watcher).

## 6. Tests

- `lsp-manager.test.ts` — mock server (child process trả diagnostics qua stdio), framing, timeout.
- `lsp-tool.test.ts` — operation trả kết quả / error khi chưa sẵn sàng.
- `edit.test.ts` — diagnostics injection (mock manager).
- Không chạy server thật trong unit test.

## 7. Verify

- `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
