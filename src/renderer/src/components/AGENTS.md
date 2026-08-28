# AGENTS.md — src/renderer/src/components

The React UI layer (renderer process). Everything the user sees: pane grid with per-agent
terminal/chat, sidebar, status bar, title bar, and dialogs. All data flows through `window.api`
(preload) — the renderer never touches Node/Electron directly.

## Key files

| File | Responsibility |
|---|---|
| `Pane.tsx` | A single agent pane: header + either `ChatPanel` (native agent) or `XtermHost` (PTY agent); background badge mode. |
| `PaneTabs.tsx` | Tab-bar layout of agent/terminal panes; all panes stay mounted (inactive ones hidden via CSS) so background agents keep streaming/answering. The active tab is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the tab that was showing); PaneTabs reports the first pane when the stored id no longer exists. Shows a confirm dialog before closing a tab. |
| `PaneHeader.tsx` | Pane title bar: status dot, git info, menu (inject/log/stop/new-session/background/delete); shows a confirm dialog before deleting an agent / closing a terminal. |
| `ConfirmDialog.tsx` | Reusable confirmation dialog (title, message, confirm/cancel, danger styling). |
| `Sidebar.tsx` | Left sidebar: workspace list, add/remove, templates, open in editor. |
| `StatusBar.tsx` | Bottom bar: workspace name, git branch, running count, app version (via IPC). |
| `TitleBar.tsx` | Custom window chrome (min/max/close) for frameless platforms. |
| `PopupTitleBar.tsx` | Popup window chrome for the FileViewer/GitViewer BrowserWindows: drag region + (Linux) custom min/max/close, mirroring the main TitleBar so popups match the app theme. |
| `XtermHost.tsx` | PTY terminal host via xterm.js. |
| `EmptyState.tsx` | Shown when no pane is open (workspace vs. no-workspace hint). |
| `BackgroundPanel.tsx` | Lists background agents; open/stop/delete them (delete shows a confirm dialog). |
| `UpdateDialog.tsx` | Auto-update status + install prompt. |
| `BrowserDialog.tsx` | Chrome bridge pairing + status UI. |
| `InstallGuideDialog.tsx` | Extension install steps for the browser bridge. |

| `ChallengeToast.tsx` | ChatGPT web challenge toast. |
| `AddAgentDialog.tsx` / `AddProjectDialog.tsx` | Creation dialogs. |
| `chat/` | The native-agent chat UI — see its own AGENTS.md. |
| `settings/` | Settings dialog + tabs — see its own AGENTS.md. |

## Conventions

- **Never** import from `electron` or `node:*` here; use `window.api` (typed `AgentApi`).
- `App.tsx` (parent) owns terminal registration and global state; components stay presentational-ish.
- UI labels and system-style notices from main (with `[meow]` prefix) are English.
