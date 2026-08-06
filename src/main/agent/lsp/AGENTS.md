# AGENTS.md — src/main/agent/lsp

Language Server Protocol support for the Meow agent: spawns language servers, tracks open
documents, and produces diagnostics text that the `lsp` tool feeds back into the agent context.

## Key files

| File | Responsibility |
|---|---|
| `manager.ts` | `LspManager`: owns clients per language, `diagnosticsText(filePath, text)` → summary string for the agent; dispose on shutdown. |
| `client.ts` | Single LSP client over stdio: initialize, open/change documents (`textDocument/didChange`), collect `textDocument/publishDiagnostics`. |
| `servers.ts` | Language server definitions (command + args per language id, e.g. typescript-language-server). |

## Conventions

- Runs only in the **main process**; renderer never talks to LSP directly.
- Errors are swallowed per-client (offline/unsupported language → no diagnostics, not a crash).
- Disabled when `lsp.enabled` is false in config; `LspManager` is optional in `MeowAgentManagerDeps`.
