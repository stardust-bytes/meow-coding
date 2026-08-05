# Meow Coding — Group C: LSP + Diagnostics: Design Spec

Ngày: 2026-08-05 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Mang LSP + diagnostics từ opencode sang meow-coding (native agent), giúp:
- Sau `write`/`edit`/`apply-patch` báo lỗi lint/type ngay (diagnostics).
- Cung cấp tool `lsp` (goToDefinition/findReferences/hover/documentSymbol) cho agent tra cứu code.

## 2. Tham chiếu opencode

- `tool/lsp.ts` — operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol,
  goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.
- `lsp/language.ts` — builtin server list (38 servers: typescript, eslint, biome, gopls, pyright,
  rust-analyzer, clangd, ...).
- Diagnostics nhúng trong write/edit/apply_patch outputs.

## 3. Quyết định thiết kế (bám sát opencode, desktop-first)

### 3.1 LSP client manager
- **Vendor**: dùng `vscode-languageserver-protocol` + tự spawn server qua node child_process
  (stdio transport), hoặc thư viện `vscode-languageserver-client` (chưa có trong deps — cần check).
- **Server đăng ký**: `LspServerSpec { language, command, args, extensions }` — khởi đầu 3 server
  phổ biến: **typescript** (`typescript-language-server --stdio`), **eslint**, **biome**.
  Các server còn lại thêm dần (config map).
- **Lifecycle**: khởi động LSP server khi workspace mở + có file thuộc language; đóng khi workspace đóng.
  Mỗi project một client-set (giống opencode `lsp/lsp.ts`).
- **Capability**: `initialize` + `textDocument/didOpen/didChange/didSave` + `publishDiagnostics` +
  `textDocument/definition|references|hover|documentSymbol`.

### 3.2 Diagnostics integration
- **Trigger**: sau `write`/`edit`/`apply-patch` thành công → chờ `publishDiagnostics` (timeout ~3s)
  → thêm vào tool output: `[LSP] <file>:<line>:<col>: <message>` (tối đa 5).
- **Config**: `lsp: { enabled: true, servers: {...} }` trong meow.json; `lsp.diagnosticsTimeoutMs = 3000`.
- **Chỉ diagnostics**: file mới mở qua `didOpen`; không đọc toàn bộ project.

### 3.3 Tool `lsp`
- Tool definition `lsp` với `operation` (trong whitelist ở trên) + `file_path`/`query`/`position`.
- Chạy qua client-set hiện tại; kết quả trả text JSON gọn (vị trí + text).
- Nếu server chưa sẵn sàng → trả error "lsp: server not ready for <lang>".

## 4. Phạm vi

- `src/main/agent/lsp/manager.ts` (mới) — spawn/connect servers, request/response, diagnostics buffer.
- `src/main/agent/lsp/servers.ts` (mới) — server registry (typescript/eslint/biome đầu tiên).
- `src/main/agent/tools/lsp.ts` (mới) — tool definition.
- `src/main/agent/tools/write.ts`, `edit.ts`, `apply-patch.ts` — inject diagnostics vào output.
- `src/main/agent/config.ts` — `lsp` config.
- `src/main/meow-agent-manager.ts` — khởi tạo LSP per workspace, cung cấp `lsp` tool.
- Tests: `lsp-manager` (mock server, diagnostics), `lsp-tool`, `edit` diagnostics injection.

## 5. Xử lý lỗi

- Server binary không tồn tại / crash → mark error, disable server, không crash app.
- Timeout diagnostics → bỏ qua, không chặn tool result.
- Tool `lsp` gọi khi chưa có server → error message.
- Không có file trong project thuộc ngôn ngữ đã cấu hình → không spawn server.

## 6. Kiểm thử & tiêu chí thành công

- Viết/edit file JS/TS → output có LSP diagnostics (mock server trả diagnostics).
- Tool `lsp` trả được definition/references (mock).
- Server lỗi → bị disable an toàn.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e` pass.
