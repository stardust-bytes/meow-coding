# Meow Coding — UI Redesign (VS Code-like, no-border, vuông vức)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle toàn bộ renderer theo thẩm mỹ **VS Code Dark+**: không dùng border box quanh element, vuông vức (border-radius = 0), chrome UI dùng proportional font (Segoe UI / system-ui), terminal + code giữ monospace, thêm status bar kiểu IDE, pane header dạng tab. Giữ nguyên toàn bộ hành vi (grid/zoom, inject, restart, chat, settings) và không phá e2e.

**Phạm vi:** Chỉ `src/renderer` (styles.css + các component React + xterm theme). Không đụng main/preload/shared, không đổi IPC channel, không đổi luồng dữ liệu.

**Spec tham khảo:** `docs/superpowers/specs/2026-08-04-meow-coding-agent-console-design.md` (§5 UI Design Direction — bản mới bổ sung nguyên tắc này).

---

## 1. Nguyên tắc thiết kế

1. **VSCode model — phân tầng surface thay vì border.** Element được tách biệt bằng màu nền theo thang `#1e1e1e → #252526 → #2a2d2e → #37373d → #3c3c3c`, giống stack surface của VS Code. Không dùng `border: 1px solid ...` để vẽ hộp quanh card/button/input/pane/dialog.
2. **Vuông vức.** `--radius: 0` áp dụng toàn app; bỏ mọi `border-radius` (kể cả status dot → hình vuông nhỏ 2px, chat bubble → block vuông).
3. **Hai tầng typography.** Chrome UI (sidebar, header, dialog, status bar, label) dùng `system-ui, 'Segoe UI'` — đây là thứ làm app giống IDE thật thay vì "cửa sổ terminal". Terminal + code + số liệu giữ `Cascadia Mono` (font mặc định VS Code hiện đại). Đổi về mono-toàn-bộ chỉ là 1 biến CSS nếu muốn.
4. **Hairline cấu trúc (tối thiểu).** Chỉ còn: (a) đường 1px phân chia vùng lớn (sidebar/editor, đỉnh status bar) đúng như VS Code dùng; (b) focus ring accent; (c) thanh accent 2px bên trái item active trong list. Đây là "structural hairline", không phải border box — nếu người dùng vẫn coi là border thì bỏ luôn và dùng chênh lệch background.
5. **Spacing 4px** giữ nguyên; số liệu dùng tabular-nums; hover/active trạng thái đổi background, không dịch layout.
6. **Icon:** không emoji. Nút menu "⋯" chuyển sang icon vector (đề xuất inline SVG hoặc `@phosphor-icons/react`). Giữ `aria-label` và text label hiện có để e2e không vỡ.

## 2. Design tokens (thay toàn bộ `:root` trong `src/renderer/src/styles.css`)

| Token | Giá trị | Ghi chú |
|---|---|---|
| `--bg` | `#1e1e1e` | editor / terminal / pane |
| `--bg-panel` | `#252526` | sidebar, dialog, header |
| `--bg-hover` | `#2a2d2e` | hover |
| `--bg-active` | `#37373d` | row/tab active |
| `--bg-tab-inactive` | `#2d2d2d` | pane header không focus |
| `--bg-input` | `#3c3c3c` | input + button mặc định |
| `--bg-input-hover` | `#4a4a4a` | hover button |
| `--bg-code` | `#1a1a1a` | code block, kbd |
| `--text` | `#cccccc` | body |
| `--text-strong` | `#e7e7e7` | title, active |
| `--text-dim` | `#9d9d9d` | secondary |
| `--text-faint` | `#6e7681` | placeholder, meta |
| `--accent` | `#3794ff` | focus / link / active |
| `--focus-ring` | `rgba(55,148,255,.4)` | focus-visible outline |
| `--green` | `#89d185` | running |
| `--green-deep` | `#4ec9b0` | syntax green |
| `--yellow` | `#dcdcaa` | idle / attention |
| `--orange` | `#ce9178` | syntax orange |
| `--red` | `#f48771` | error / danger |
| `--radius` | `0` | toàn app |
| `--font-ui` | `system-ui, 'Segoe UI', sans-serif` | chrome UI |
| `--font-mono` | `'Cascadia Mono', 'Fira Code', Consolas, monospace` | terminal/code |

**Lớp surface (thay thế border box):**
- Card/panel/pane header: `--bg-panel`.
- Pane header active (zoomed/focus): `--bg-tab-inactive` + 1px accent phía trên (như tab VS Code) hoặc `--bg-active`.
- List row hover: `--bg-hover`; active: `--bg-active` + thanh accent 2px trái.
- Input/button: `--bg-input`; focus: outline `--accent` 1px, không border.

**Scrollbar:** custom kiểu VS Code (track trong suốt, thumb `#424242` square, hover `#4f4f4f`), áp dụng `.chat-feed`, `.sidebar`, `.chat-md pre`, `.tool-call-*`.

## 3. Bố cục tổng thể

```
┌───────────────────────────────────────────────┐
│  sidebar (không border-right, chỉ hairline)    │
│  ┌─────────────────────┬───────────────────┐  │
│  │ PROJECTS  [⋮]       │  pane-grid (gap=4)│  │
│  │  ▶ repo-a      2    │  ┌──────┐ ┌─────┐ │  │
│  │  ▶ repo-b      0    │  │tab-hd│ │tab-hd│ │  │
│  │  [+ agent]          │  │term  │ │chat  │ │  │
│  │  Templates (col.)    │  └──────┘ └─────┘ │  │
│  └─────────────────────┴───────────────────┘  │
│  STATUS BAR: main ● 3  │ 2 agents running │    │
└───────────────────────────────────────────────┘
```

Thay đổi cấu trúc chính:
- **Status bar mới** (component mới, thêm vào `App.tsx`): workspace name + git `branch ● dirty`, số agent running, template/provider đang dùng, version. Là dấu ấn "IDE" lớn nhất.
- **Pane header → tab-like**: active (pane đang zoom / được click gần nhất) có thanh accent trên + nền tối hơn; inactive dùng `--bg-tab-inactive`. Có thể thêm state "focusedPane" trong `PaneGrid` để active đúng pane vừa click.
- **Activity bar (optional, để sau):** strip icon 48px trái cùng — không nằm trong phạm vi đợt này.

---

## Task 1: Tokens + base global (styles.css)

**Files:** `src/renderer/src/styles.css`

- [ ] **Step 1:** Thay `:root` bằng bảng token ở §2; thêm `--font-ui`, `--radius`, token surface, scrollbar vars.
- [ ] **Step 2:** `body`: `font-family: var(--font-ui)`, giữ `font-size: 13px`; `button, input, select, textarea` dùng `font-family: inherit` (mono chỉ dành riêng cho terminal/code qua class).
- [ ] **Step 3:** Global `* { border-radius: var(--radius) !important }` — hoặc rà tất cả class bỏ `border-radius` thủ công (ưu tiên thủ công, tránh `!important`).
- [ ] **Step 4:** Custom scrollbar (webkit): track trong suốt, thumb `#424242`, width 10px.
- [ ] **Step 5:** `:focus-visible` outline 1px `--accent`; không dùng `outline: none` đơn độc.
- [ ] **Step 6:** Xoá mọi `border: 1px solid var(--border)` còn lại; thay surface qua background. Chỉ giữ hairline phân vùng lớn (`.sidebar` dùng hairline phải; status bar đỉnh hairline).

## Task 2: Sidebar kiểu VS Code (explorer)

**Files:** `src/renderer/src/styles.css`, `src/renderer/src/components/Sidebar.tsx`, `TemplatesPanel.tsx`

- [ ] **Step 1:** `.panel-title` → section header VS Code: 11px, uppercase, `letter-spacing: 1px`, `--text-faint`, không border-bottom (dùng cách khoảng).
- [ ] **Step 2:** `.project-list li` bỏ radius; `.project-row` padding `2px 8px`, hover `--bg-hover`; `li.active` → `--bg-active` + `box-shadow: inset 2px 0 0 var(--accent)` (thanh accent trái).
- [ ] **Step 3:** Nút "⋯" và nút menu thành icon button "ghost" (không border, nền trong suốt, hover `--bg-hover`); giữ `aria-label="menu"` / `menu {name}`.
- [ ] **Step 4:** Nút "+ agent" → button kiểu sidebar VS Code: full-width, background transparent, hover `--bg-hover`, text bắt đầu bằng icon `+`.
- [ ] **Step 5:** `.sidebar-error`, `.templates-panel`, `.template-form`, `.template-list` bỏ border/radius; nhóm Templates ngầm định theo section header.
- [ ] **Step 6:** Dropdown menu (`.sidebar-menu-dropdown`) bỏ border/radius + shadow nhẹ; `.menu-item` bỏ radius.

## Task 3: Pane grid + header dạng tab

**Files:** `src/renderer/src/styles.css`, `src/renderer/src/components/PaneGrid.tsx`, `Pane.tsx`, `PaneHeader.tsx`

- [ ] **Step 1:** `.pane` bỏ `border` + `border-radius`; nền `--bg`. Grid `gap: 4px` (nền app lộ ra → phân cách không cần border).
- [ ] **Step 2:** `.pane-header` bỏ border-bottom + radius; nền `--bg-panel`, height 28px giữ nguyên. Thêm state focus: pane được click → `.pane-header.active` (nền `--bg-tab-inactive` hoặc `--bg-active` + `box-shadow: inset 0 1px 0 var(--accent)`).
- [ ] **Step 3:** Thêm `focusedId` state vào `PaneGrid` (mặc định pane đầu; click pane → set; Esc zoom thoát giữ nguyên). Truyền `active` xuống `PaneHeader`. Khi zoom, pane zoom đó là active.
- [ ] **Step 4:** `.status-dot` → hình vuông 2px (`border-radius: 0`), giữ màu theo status. `.pane-status`, `.pane-git` giữ nguyên nhưng `--text-dim`/`--text-faint`, `font-variant-numeric: tabular-nums`.
- [ ] **Step 5:** Nút action trong `.pane-actions` (inject/stop/restart/log/zoom) → ghost buttons: bỏ border + radius, `background: transparent`, hover `--bg-hover`, padding `2px 6px`. Giữ text label (e2e dùng text?). Khi `alert-attention`/`alert-error` → đổi màu dot/header thay vì border-bottom màu.
- [ ] **Step 6:** `.inject-input` bỏ border; nền `--bg-input`.

## Task 4: Chat panel (native agent) vuông + không border

**Files:** `src/renderer/src/styles.css` (+ giữ nguyên JSX `ChatPanel.tsx` nếu không cần)

- [ ] **Step 1:** `.chat-text` bỏ radius (8px→0) + border; user: `--bg-input` (hoặc `#2a3f5f` giữ để phân biệt, nhưng vuông); assistant: `--bg-panel`. `max-width` giữ.
- [ ] **Step 2:** `.tool-call` bỏ border/radius; header nền `--bg-panel`, dùng `border-bottom: 1px solid` → đổi thành 1px hairline `rgba(255,255,255,0.06)` (không nhìn như border box) hoặc để trống. `.tool-call-input` giữ top hairline mảnh.
- [ ] **Step 3:** `.chat-reasoning` bỏ border/radius; nền `#1f1f1f`. `.chat-prompt` bỏ radius/border vàng; dùng nền `--bg-panel` + viền trái `--yellow` 2px.
- [ ] **Step 4:** `.chat-composer` border-top → hairline; `.chat-input-field` bỏ radius/border, nền `--bg-input`, focus outline accent. `.chat-input-send` bỏ radius/border; mặc định text accent, running text đỏ.
- [ ] **Step 5:** Nút mode (build/plan) giữ text; active = nền `--bg-active` + text accent (bỏ border accent).
- [ ] **Step 6:** Markdown `.chat-md code/pre/blockquote/table` bỏ radius + border box; dùng `--bg-code`; blockquote dùng viền trái hairline. `.diff-view` giữ background đỏ/xanh pha (đã không border).

## Task 5: Dialog (Add project/agent, Settings) vuông, không border

**Files:** `src/renderer/src/styles.css`

- [ ] **Step 1:** `.dialog-backdrop` scrim giữ `rgba(0,0,0,.5)`; `.dialog` bỏ border + radius, nền `--bg-panel`, shadow nhẹ `0 8px 24px rgba(0,0,0,.4)` (VS Code dialog có shadow, không border).
- [ ] **Step 2:** `.btn` bỏ border/radius; nền `--bg-input`, hover `--bg-input-hover`; `.btn.primary` nền `--accent`, không border; `.btn:disabled` opacity giữ. `.btn.small` giữ.
- [ ] **Step 3:** `.input` bỏ border/radius; nền `--bg-input`, hover sáng hơn, focus outline accent. `.label` giữ uppercase nhưng đổi `--text-faint`.
- [ ] **Step 4:** `.provider-row`, `.mcp-row`, `.settings-hint` chỉnh màu text theo token mới; `.settings-dialog` max-height giữ.

## Task 6: Status bar + Empty state

**Files:** tạo `src/renderer/src/components/StatusBar.tsx`; sửa `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `EmptyState.tsx`

- [ ] **Step 1:** Tạo `StatusBar.tsx` (props: `workspaceName`, `git`, `agentStates`): hiển thị trái = workspace name + git `branch ● dirty` (nếu có); phải = `n agent(s) running`, provider/template label nếu dễ lấy, `v0.1.0`. Nền `--accent`? Không — VS Code status bar màu `#007acc`/`--bg-input`; chọn nền `#0d1117` hoặc `--accent` tối. Đề xuất: nền `--accent` giảm độ sáng (`#2566a8`) để thành điểm nhấn duy nhất có màu, giống VS Code.
- [ ] **Step 2:** `App.tsx`: render `<StatusBar>` cuối `.app` (đổi `.app` thành flex column; `.main` flex-1). Truyền `runtime?.workspace.name`, `runtime?.git`, `runtime?.agents`.
- [ ] **Step 3:** CSS `.status-bar`: height 22px, `font-size 12px`, `--font-mono` cho số, tabular-nums, hairline trên.
- [ ] **Step 4:** `.empty-state` restyle: font ui, `--text-dim`, thêm mark ">_" hoặc khối vuông nhỏ (inline SVG, không emoji); giữ text hiện có (e2e không đụng vào).

## Task 7: Xterm theme + tinh chỉnh markdown/diff (optional, nhỏ)

**Files:** `src/renderer/src/components/XtermHost.tsx`, `src/renderer/src/styles.css`

- [ ] **Step 1:** Đồng bộ xterm `theme` với token: `background: #1e1e1e`, `foreground: #cccccc`, `selectionBackground: #264f78`, cursor `#aeafad` (giữ palette ANSI hiện tại — đã chuẩn VS Code).
- [ ] **Step 2:** Đảm bảo `.xterm-host` padding 0, `.xterm-viewport` scrollbar khớp theme.
- [ ] **Step 3:** Rà soát `.chat-md` code/pre để mono + `--bg-code`, không border box.

## Task 8: Xác minh + rà soát e2e

- [ ] **Step 1:** `npm run typecheck` pass.
- [ ] **Step 2:** `npm test` pass.
- [ ] **Step 3:** `npm run build && npm run e2e` pass. **Lưu ý:** giữ nguyên các selector/class e2e đang dùng: `.sidebar`, `.project-row`, `.chat-panel`, `.chat-input-field`, `.chat-input-send`, `.chat-msg.user`, `.chat-mode-hint`, `.settings-dialog`, `.mcp-status`, `.provider-row`, `.settings-actions select`, và accessible name `menu`, `menu E2E Project`, `settings`, `add`, `Save`, `plan`, `build`, `Open in VS Code`, `Remove`.
- [ ] **Step 4:** Chạy `npm run dev`, tự kiểm tra bằng mắt: không còn border box, góc vuông, status bar hiển thị, hover/active đổi background, scrollbar gọn, zoom + Esc vẫn mượt.

---

## Những thứ KHÔNG được phá

- **Cơ chế buffer** (output trước khi xterm mount → `buffersRef`) — không đụng App logic, chỉ layout.
- **Hành vi** grid/zoom, inject, restart, stop, open log, git poll, chat send/stop, mode switch, permission prompt (Tab/1/2/3, ←/→/Enter).
- **Selectors e2e** ở Task 8 Step 3 — nếu bắt buộc đổi tên class, cập nhật `tests/e2e/*.spec.ts` cùng commit.
- **Không** thêm dependency mới bắt buộc; Phosphor icon chỉ nếu đã chốt (có thể dùng inline SVG trước).
- Giữ `user-select: none` ngoài vùng chat/terminal; giữ khả năng select text trong `.chat-text`, `.chat-md`, `.tool-call-*`.

## Tiêu chí hoàn thành

1. Không còn border box quanh card/button/input/pane/dialog; toàn app góc vuông.
2. Chrome UI = system-ui, terminal/code = Cascadia Mono; hierarchy rõ ràng.
3. Status bar hiển thị đúng git branch/dirty + số agent running.
4. Pane header phân biệt active/inactive như tab; hover/active đổi nền không dịch layout.
5. `typecheck`, `npm test`, `build + e2e` xanh.
