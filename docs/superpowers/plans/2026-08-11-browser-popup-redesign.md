# Browser Popup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `BrowserDialog.tsx` (Browser Bridge) and `InstallGuideDialog.tsx` (Install Guide) into a wider, sectioned layout with a centered pairing flow, and capitalize their button labels to Title Case.

**Architecture:** Pure UI/CSS change, no new state or IPC. Add a `.browser-dialog` width modifier and new section/pill/pairing CSS classes to `styles.css`, then restructure the two component render trees to use them. No new logic — everything driven by props/state the components already receive.

**Tech Stack:** React (renderer), plain CSS (no CSS-in-JS), existing `.btn`/`.dialog`/`.row` classes from the app's design system.

## Global Constraints

- Dialog width for these two popups only: 540px (not the default 420px `.dialog` width — do not change the default).
- Button labels: Title Case ("Open Install Guide", "Extension Folder", "Pair With Code", "New Pairing Code", "Close", "Open chrome://extensions"). `chrome://extensions` itself stays lowercase (URL literal).
- Out of scope: `StatusBar.tsx` browser status text (not a button), `AddProjectDialog.tsx`/`AddAgentDialog.tsx` (not part of "browser popup" scope).
- No new unit/e2e tests — this is a pure layout/CSS change with no new logic (spec section 5). Verify with `npm run typecheck` (tsconfig.web.json) and a manual visual check via `npm run dev`.

---

### Task 1: Add browser-dialog CSS (width, sections, pill, centered pairing)

**Files:**
- Modify: `src/renderer/src/styles.css:370-374` (near `.dialog`/`.dialog-actions` — add width modifier)
- Modify: `src/renderer/src/styles.css:429-444` (`.browser-*` block — remove dead rules, add new ones, change `.browser-pairing` layout)

**Interfaces:**
- Consumes: nothing (CSS only).
- Produces: CSS classes consumed by Task 2 and Task 3 — `browser-dialog`, `browser-hd`, `browser-pill`, `browser-pill-on`, `browser-pill-off`, `browser-section`, `browser-section-label`, `browser-pairing-cta`, plus the existing `browser-hint`/`browser-pairing`/`browser-code`/`browser-guide`/`browser-guide-dir` (kept, `browser-pairing` restyled).

- [ ] **Step 1: Add the `.browser-dialog` width modifier next to `.dialog-actions`**

In `src/renderer/src/styles.css`, find this block (around line 372-374):

```css
.dialog h3 { margin: 0; font-size: var(--fs-lg); font-family: var(--font-display); font-weight: var(--fw-semibold); }
.label { font-size: var(--fs-base); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-strong); font-family: var(--font-display); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 6px; }
```

Add immediately after it:

```css
.dialog.browser-dialog { width: 540px; }
```

- [ ] **Step 2: Replace the `.browser-*` block with the sectioned/pill/centered-pairing version**

Find this block (around line 429-444):

```css
.browser-status { margin: 0 0 8px; font-size: var(--fs-md); }
.browser-row { display: flex; flex-direction: column; gap: 8px; }
.browser-hint { margin: 0; font-size: var(--fs-md); color: var(--text-dim); line-height: 1.5; }
.browser-pairing { display: flex; align-items: center; gap: 10px; }
.browser-code {
  font-family: var(--font-mono); font-size: 22px; letter-spacing: 4px; color: var(--accent);
  user-select: all; padding: 4px 8px; border: 1px dashed var(--accent-dim); border-radius: 4px;
}
.browser-guide { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-md); color: var(--text); line-height: 1.5; }
.browser-guide li { margin: 0; }
.browser-guide-dir {
  display: block; margin-top: 4px; padding: 4px 8px; font-family: var(--font-mono);
  font-size: var(--fs-md); color: var(--text-strong); background: var(--bg-panel);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  user-select: all; word-break: break-all;
}
```

Replace it with (drops the now-unused `.browser-status`/`.browser-row`, adds header/section/pill/centered-pairing classes, keeps `.browser-hint`/`.browser-code`/`.browser-guide*` as-is):

```css
.browser-hd { display: flex; align-items: center; justify-content: space-between; }
.browser-hd h3 { margin: 0; }
.browser-pill {
  font-family: var(--font-mono); font-size: var(--fs-sm); padding: 2px 8px;
  border-radius: 999px; border: 1px solid var(--hairline); color: var(--text-dim);
}
.browser-pill-off { color: var(--accent); border-color: var(--accent-dim); }
.browser-pill-on { color: var(--green); border-color: rgba(76, 227, 161, 0.35); }
.browser-section { padding-top: 12px; border-top: 1px solid var(--hairline); }
.browser-section:first-of-type { padding-top: 0; border-top: none; }
.browser-section-label {
  font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-strong); font-weight: var(--fw-semibold); margin: 0 0 8px;
  font-family: var(--font-display);
}
.browser-hint { margin: 0; font-size: var(--fs-md); color: var(--text-dim); line-height: 1.5; }
.browser-pairing-cta { display: flex; justify-content: center; }
.browser-pairing { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.browser-code {
  font-family: var(--font-mono); font-size: 22px; letter-spacing: 4px; color: var(--accent);
  user-select: all; padding: 4px 8px; border: 1px dashed var(--accent-dim); border-radius: 4px;
}
.browser-guide { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-md); color: var(--text); line-height: 1.5; }
.browser-guide li { margin: 0; }
.browser-guide-dir {
  display: block; margin-top: 4px; padding: 4px 8px; font-family: var(--font-mono);
  font-size: var(--fs-md); color: var(--text-strong); background: var(--bg-panel);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  user-select: all; word-break: break-all;
}
```

- [ ] **Step 3: Verify no other file references the removed classes**

Run: `grep -rn "browser-status\|browser-row" src/`
Expected: no matches (both classes are being deleted; Task 2 removes their only usages in the same commit sequence — if this still matches after Task 2 is also done, something was missed).

Note: at the end of Task 1 alone (before Task 2 runs), `BrowserDialog.tsx` still references `browser-status`/`browser-row` — that's expected and fixed by Task 2. Don't treat that as a failure at this step; this grep is a final check to run again after Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "style(browser): add sectioned/pill/centered-pairing CSS for browser dialogs"
```

---

### Task 2: Restructure BrowserDialog.tsx into sections + Title Case labels

**Files:**
- Modify: `src/renderer/src/components/BrowserDialog.tsx` (full rewrite of the render tree)

**Interfaces:**
- Consumes: CSS classes from Task 1 (`browser-dialog`, `browser-hd`, `browser-pill`, `browser-pill-on`, `browser-pill-off`, `browser-section`, `browser-section-label`, `browser-hint`, `browser-pairing-cta`, `browser-pairing`, `browser-code`); existing `window.api.pairBrowser()`, `window.api.openBrowserInstallGuide()`, `window.api.openBrowserExtensionFolder()` (unchanged signatures); existing `row` utility class (`src/renderer/src/styles.css:246`, `display:flex; gap:6px;`) for the Setup button row.
- Produces: n/a (leaf component, rendered from `App.tsx` — its own props (`status`, `onClose`) are unchanged, so no caller updates needed).

- [ ] **Step 1: Replace the full file content**

Replace `src/renderer/src/components/BrowserDialog.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { BrowserStatusInfo, PairingInfo } from '@shared/browser-types'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [pairing, setPairing] = useState<PairingInfo | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pair = async () => {
    setPairing(await window.api.pairBrowser())
  }

  const stateLabel = status?.paired
    ? `paired${status.port ? ` (port ${status.port})` : ''}`
    : status?.status === 'listening' || status?.status === 'idle'
      ? 'waiting for extension'
      : status?.status ?? 'unknown'

  return (
    <div className="dialog-backdrop">
      <div className="dialog browser-dialog">
        <div className="browser-hd">
          <h3>Browser Bridge</h3>
          <span className={`browser-pill ${status?.paired ? 'browser-pill-on' : 'browser-pill-off'}`}>
            ● {stateLabel}
          </span>
        </div>
        {status?.paired ? (
          <>
            <div className="browser-section">
              <p className="browser-section-label">Connection</p>
              <p className="browser-hint">Extension is paired and ready.</p>
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={pair}>New Pairing Code</button>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="browser-section">
              <p className="browser-section-label">Setup</p>
              <p className="browser-hint">
                Install the extension in Chrome, then pair it with a one-time code.
              </p>
              <div className="row">
                <button className="btn" onClick={() => void window.api.openBrowserInstallGuide()}>Open Install Guide</button>
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
              </div>
            </div>
            <div className="browser-section">
              <p className="browser-section-label">Pairing</p>
              {pairing ? (
                <div className="browser-pairing">
                  <span className="browser-code">{pairing.code}</span>
                  <span className="browser-hint">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span>
                </div>
              ) : (
                <div className="browser-pairing-cta">
                  <button className="btn primary" onClick={pair}>Pair With Code</button>
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the web project**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors.

- [ ] **Step 3: Confirm the removed CSS classes have no remaining references**

Run: `grep -rn "browser-status\|browser-row" src/`
Expected: no matches (this is the real check deferred from Task 1 Step 3 — both classes are gone from CSS and from this component now).

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`
In the app: open a workspace, click the browser status pill in the bottom status bar to open the Browser Bridge dialog.
- If not paired: confirm the dialog is ~540px wide, shows a "Setup" section with two buttons in a row, a "Pairing" section with a centered "Pair With Code" button (not full-width), and a status pill top-right reading "off" or "waiting for extension" in red.
- Click "Pair With Code": confirm the code and "Expires ..." text appear stacked and centered under the "Pairing" label.
- (Optional, needs a paired extension) If paired: confirm the pill reads "paired (port N)" in green, and the section reads "Connection" / "Extension is paired and ready." with "New Pairing Code" / "Close" actions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/BrowserDialog.tsx
git commit -m "feat(browser): sectioned Browser Bridge dialog, centered pairing, Title Case labels"
```

---

### Task 3: Widen InstallGuideDialog.tsx and capitalize its button labels

**Files:**
- Modify: `src/renderer/src/components/InstallGuideDialog.tsx`

**Interfaces:**
- Consumes: `browser-dialog` CSS class from Task 1; existing `window.api.openBrowserChromeExtensions()`, `window.api.openBrowserExtensionFolder()` (unchanged signatures).
- Produces: n/a (leaf component, rendered from `App.tsx` — props (`guide`, `onClose`) unchanged).

- [ ] **Step 1: Apply the width class and capitalize button labels**

In `src/renderer/src/components/InstallGuideDialog.tsx`, change:

```tsx
      <div className="dialog">
```
to:
```tsx
      <div className="dialog browser-dialog">
```

And change the actions row from:

```tsx
        <div className="dialog-actions">
          <button className="btn" onClick={() => void window.api.openBrowserChromeExtensions()}>open chrome://extensions</button>
          <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>extension folder</button>
          <button className="btn primary" onClick={onClose}>close</button>
        </div>
```
to:
```tsx
        <div className="dialog-actions">
          <button className="btn" onClick={() => void window.api.openBrowserChromeExtensions()}>Open chrome://extensions</button>
          <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
```

- [ ] **Step 2: Typecheck the web project**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors.

- [ ] **Step 3: Manual visual check**

Run: `npm run dev` (if not already running from Task 2).
In the app: open the Browser Bridge dialog (not paired), click "Open Install Guide". Confirm the Install Guide dialog is ~540px wide and the three action buttons read "Open chrome://extensions", "Extension Folder", "Close".

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/InstallGuideDialog.tsx
git commit -m "style(browser): widen Install Guide dialog, Title Case button labels"
```

---

### Task 4: Full-suite regression check

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: n/a — final gate before considering the plan done.

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: all tests pass (this change touches no logic, so the existing 536 tests should be unaffected).

- [ ] **Step 2: Run the e2e smoke suite**

Run: `npx playwright test tests/e2e/smoke.spec.ts`
Expected: all 4 tests pass (none of them open the Browser dialog directly, but this confirms the app still boots and renders after the CSS/component changes).

- [ ] **Step 3: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.extension.json`
Expected: no errors.
