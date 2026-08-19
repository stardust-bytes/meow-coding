# AGENTS.md — src/renderer/src/components/settings

The Settings dialog: a tabbed screen editing the whole `meow.json`-backed `MeowSettings` object.
Reads via `window.api.getSettings()`, saves via `saveSettings(settings)`; changes propagate to the
main process config.

## Key files

| File | Responsibility |
|---|---|
| `SettingsDialog.tsx` | Dialog shell: loads settings/catalog/MCP status, tab switching, `patch()` draft state, save flow. |
| `ProvidersTab.tsx` | Provider list: add/connect (API key + base URL), fetch models from catalog, default provider. |
| `AgentsTab.tsx` | Per-agent config (name, system prompt, provider/model). |
| `PermissionsTab.tsx` | Tool permission rules (allow/ask/deny). |
| `McpTab.tsx` | MCP server configs + connection status. |
| `ContextTab.tsx` | Context/compaction settings: max tokens, max steps, notifications, tool-output limits. |
| `CommandsTab.tsx` | Slash-command editor (project-level). |
| `ChatGptWebTab.tsx` | ChatGPT web login/session tab. |
| `TemplatesTab.tsx` | Agent template CRUD. |
| `UpdatesTab.tsx` | Update channel + check/install. |
| `Modal.tsx` | Reusable modal shell for the settings dialog. |

## Conventions

- `MeowSettings` shape lives in `src/shared/types.ts`; adding a setting touches shared types + `src/main/agent/config.ts` normalize + this dialog.
- Edits go through `patch()` on a draft — nothing writes until Save; `saveSettings` returns the normalized settings.
- UI labels are English.
