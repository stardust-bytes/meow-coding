# AGENTS.md — src/main/agent/mcp

Model Context Protocol support: connects to MCP servers configured in `meow.json`, lists their
tools, and exposes them to the Meow agent as `ToolDefinition`s alongside the built-in registry.

## Key files

| File | Responsibility |
|---|---|
| `manager.ts` | `McpManager`: `connect(servers)` (closeAll → per-server client), `getTools()`, `getStatus()`, `closeAll()` on dispose. Also defines `McpServerConfig` type + status shape. |

## Conventions

- MCP tools are merged into the agent tool map in `MeowAgentManager.syncTools()` — after user tools, before nothing else.
- Server config comes from `meow.json` `mcp` field; status surfaced via `getMcpStatus` IPC.
- Only the main process talks to MCP servers; failures mark the server `error` in status without crashing.
