# Pane Tabs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split-screen PaneGrid with a tab bar so each agent/terminal is a tab that fills the main content area when active.

**Architecture:** Rename `PaneGrid` → `PaneTabs` with column layout (tab bar on top, active pane below). Remove zoom. Keep background, pane header menus, and Chat/Trace toggle. Pure renderer change — no IPC/main changes.

**Tech Stack:** React 19 + TypeScript strict, xterm.js, CSS in `styles.css`. No React component test infra (tests are pure-logic); verification is typecheck + build + e2e.

## Global Constraints

- UI labels in English; system-style notices from main in Vietnamese with `[meow]` prefix.
- Renderer never imports `electron`/`node:*`; uses `window.api` (typed `AgentApi`).
- Do not add unnecessary comments.
- Trace disabled app-wide: `trace.enabled` default false; pane hides Trace tab unless enabled.
- `PaneTabs` file replaces `PaneGrid` (same directory); update the sibling `AGENTS.md`.

---

### Task 1: Rename PaneGrid → PaneTabs with tab-bar layout

**Files:**
- Create: `src/renderer/src/components/PaneTabs.tsx`
- Delete: `src/renderer/src/components/PaneGrid.tsx`
- Modify: `src/renderer/src/App.tsx` (import + usage)

**Interfaces:**
- Consumes: `PaneModel` from `../App`; props from App: `panes`, `backgrounds`, `isTerminal`, `onRemove`, `onRegisterTerminal`, `onUnregisterTerminal`.
- Produces: `<PaneTabs panes={} backgrounds={} isTerminal={} onRemove={} onRegisterTerminal={} onUnregisterTerminal={} />` — same props signature as old `PaneGrid` (minus zoom, which was internal).

- [ ] **Step 1: Create the new component**

```tsx
import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  backgrounds: Record<string, boolean>
  isTerminal: (id: string) => boolean
  onRemove: (agentId: string) => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
}

export default function PaneTabs({ panes, backgrounds, isTerminal, onRemove, onRegisterTerminal, onUnregisterTerminal }: Props) {
  const [activeId, setActiveId] = useState<string | null>(panes[0]?.agent.id ?? null)

  // Keep active tab valid as the pane list changes (add/remove).
  useEffect(() => {
    if (panes.length === 0) { setActiveId(null); return }
    if (activeId && panes.some(p => p.agent.id === activeId)) return
    setActiveId(panes[0].agent.id)
  }, [panes, activeId])

  const active = panes.find(p => p.agent.id === activeId) ?? panes[0]

  return (
    <div className="agent-tabs-view">
      <div className="agent-tab-bar" role="tablist">
        {panes.map(pane => (
          <div
            key={pane.agent.id}
            role="tab"
            aria-selected={pane.agent.id === (active?.agent.id ?? null)}
            className={`agent-tab ${pane.agent.id === (active?.agent.id ?? null) ? 'active' : ''}`}
            onClick={() => setActiveId(pane.agent.id)}
          >
            <span className={`status-dot status-${pane.state.status}`} />
            <span className="agent-tab-name">{pane.agent.name}</span>
            {panes.length > 1 ? (
              <button
                className="agent-tab-close"
                aria-label={`Close ${pane.agent.name}`}
                onClick={e => { e.stopPropagation(); onRemove(pane.agent.id) }}
              >✕</button>
            ) : null}
          </div>
        ))}
      </div>
      {active ? (
        <Pane
          key={active.agent.id}
          pane={active}
          background={Boolean(backgrounds[active.agent.id])}
          isTerminal={isTerminal(active.agent.id)}
          active
          onFocus={() => setActiveId(active.agent.id)}
          onRemove={() => onRemove(active.agent.id)}
          onRegisterTerminal={onRegisterTerminal}
          onUnregisterTerminal={onUnregisterTerminal}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Update App.tsx import + usage**

Replace:
```tsx
import PaneGrid from './components/PaneGrid'
...
<PaneGrid
  panes={panes}
  ...same props...
/>
```
with:
```tsx
import PaneTabs from './components/PaneTabs'
...
<PaneTabs
  panes={panes}
  backgrounds={backgrounds}
  isTerminal={id => terminals.some(t => t.id === id)}
  onRemove={handleRemovePane}
  onRegisterTerminal={registerTerminal}
  onUnregisterTerminal={unregisterTerminal}
/>
```

- [ ] **Step 3: Delete PaneGrid.tsx**

```bash
rm src/renderer/src/components/PaneGrid.tsx
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (verify no remaining reference to `PaneGrid` in `App.tsx`).

---

### Task 2: Remove zoom from Pane and PaneHeader

**Files:**
- Modify: `src/renderer/src/components/Pane.tsx`
- Modify: `src/renderer/src/components/PaneHeader.tsx`

**Interfaces:**
- Consumes: `PaneTabs` no longer passes `zoomed`/`onZoom`.
- Produces: `PaneHeader` props without `zoomed`; menu without Zoom items.

- [ ] **Step 1: Update Pane.tsx**

Remove `zoomed` and `onZoom` from the `Props` interface and destructuring. Remove from className:
```tsx
<div className={`pane ${background ? 'backgrounded' : ''} ${active ? 'active' : ''} status-${pane.state.status}`} onClick={onFocus}>
```
Remove `zoomed={zoomed}` and `onZoom={onZoom}` from `<PaneHeader ... />`.

- [ ] **Step 2: Update PaneHeader.tsx**

Remove `zoomed: boolean` from `Props`, the `zoomed = false` default in destructuring, and the two Zoom menu lines:
```tsx
{zoomed ? 'Exit zoom' : 'Zoom'}
```
and
```tsx
{zoomed ? 'Exit zoom' : 'Zoom'}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no `zoomed`/`onZoom` references remain in `Pane`/`PaneHeader`).

---

### Task 3: Add tab bar CSS

**Files:**
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: class names from `PaneTabs` (`.pane-tabs-view`, `.pane-tab-bar`, `.pane-tab`, `.pane-tab.active`, `.pane-tab-name`, `.pane-tab-close`).

- [ ] **Step 1: Add styles**

Append near the existing `.pane-grid` block (line ~392), and replace the `.pane-grid { flex:1; ... }` rule with the tab layout:

```css
/* Agent/terminal tab bar (was PaneGrid split-screen).
   NOTE: class prefix `agent-tab-*` — do NOT reuse `.pane-tab` which is the
   native agent Chat/Trace toggle inside PaneHeader. */
.agent-tabs-view { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.agent-tab-bar {
  display: flex; gap: 4px; align-items: center; padding: 6px 8px 0;
  border-bottom: 1px solid var(--hairline); overflow-x: auto; flex: 0 0 auto;
}
.agent-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: var(--bg-panel); border: 1px solid var(--hairline); border-bottom: none;
  border-radius: var(--radius) var(--radius) 0 0; color: var(--text-dim);
  font-size: var(--fs-sm); cursor: pointer; white-space: nowrap; user-select: none;
}
.agent-tab:hover { background: var(--bg-hover); color: var(--text); }
.agent-tab.active {
  background: var(--bg-active); color: var(--text-strong);
  border-top: 2px solid var(--accent);
}
.agent-tab-name { font-weight: var(--fw-semibold); }
.agent-tab-close {
  appearance: none; border: none; background: transparent; color: var(--text-faint);
  cursor: pointer; font: inherit; font-size: var(--fs-xs); padding: 0 2px; line-height: 1;
}
.agent-tab-close:hover { color: var(--red); }
/* The active pane fills the remaining height below the tab bar. */
.agent-tabs-view .pane { flex: 1; min-height: 0; }
```

Also remove the now-unused `.pane-grid`/`.zoom-mode` rules (lines ~397-406) and the `.pane-grid` animation at line 173:

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

---

### Task 4: Update AGENTS.md docs

**Files:**
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update the table + conventions**

Change the `PaneGrid.tsx` row to `PaneTabs.tsx`:
```
| `PaneTabs.tsx` | Tab-bar layout of agent/terminal panes; only the active tab renders; tracks active tab. |
```
Remove the zoom mention from the `PaneHeader.tsx` row (it lists menu: inject/log/stop/zoom/... → remove `zoom`).

Also update the key files doc and the top-level docs if needed later.

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + tests + build**

Run:
```bash
npm run typecheck
npm test
npm run build
```
Expected: all PASS.

- [ ] **Step 2: E2E**

Run: `npm run e2e`
Expected: PASS — especially `smoke.spec.ts` (main window) and `trace-panel.spec.ts` (uses `.pane-tab` for Chat/Trace toggle, which is unchanged).

- [ ] **Step 3: Manual smoke**

In dev, add an agent (should open a tab), open a terminal (should open a second tab), switch tabs, close a tab (returns to previous / EmptyState), background an agent (still a tab, shows "click to open"). Confirm no Zoom item in the pane menu.
