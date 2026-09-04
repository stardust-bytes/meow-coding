# Personalize — App-wide Font Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Personalize** tab in the Settings dialog with a single **Font size** (integer px) field that sets `font-size` on `<html>`/`<body>` directly, scaling the whole app including the xterm terminal.

**Architecture:** Store the preference in `localStorage` under `meow.fontSize` (default `14`), mirroring the existing `meow.theme`/`applyTheme()` pattern. A new `font.ts` helper applies the value as an inline `font-size` on `<html>` (overriding the CSS `html { font-size: 14px }` default), which scales all `rem`-based `--fs-*` tokens. The xterm terminal does NOT inherit from `<html>` (it sets px in JS), so each `XtermHost` reads the size and updates `term.options.fontSize` + re-`fit()` on change.

**Tech Stack:** TypeScript, React 19, Electron renderer, xterm.js, Vitest (node env for unit tests). No main-process / IPC / `MeowSettings` changes.

## Global Constraints

- `window.api` is the only main-process access channel; the renderer never imports `node:*`/`electron`.
- The preference is **renderer-only** — do NOT add `fontSize` to `MeowSettings`, `config.ts`, or IPC.
- Persist under localStorage key `meow.fontSize`, default `14`, clamp range `8–40` px (integer).
- Keep the CSS default `html { font-size: 14px }` in `styles.css`; the inline style overrides it.
- UI labels are English.
- `styles.css`, `tests/**` and some files use **CRLF** line endings — edit them with a script (e.g. python) if the edit tool cannot match a string.

---

### Task 1: Pure font-size helpers + unit tests

**Files:**
- Create: `src/renderer/src/font.ts`
- Test: `tests/unit/font-size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_FONT_SIZE: number` (= `14`)
  - `MIN_FONT_SIZE: number` (= `8`)
  - `MAX_FONT_SIZE: number` (= `40`)
  - `FONT_SIZE_STORAGE_KEY: string` (= `'meow.fontSize'`)
  - `FONT_SIZE_CHANGE_EVENT: string` (= `'meow:fontsize'`)
  - `clampFontSize(size: number): number`
  - `parseFontSize(raw: string | null): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/font-size.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, clampFontSize, parseFontSize
} from '../../src/renderer/src/font'

describe('font-size helpers', () => {
  it('defaults size constants', () => {
    expect(DEFAULT_FONT_SIZE).toBe(14)
    expect(MIN_FONT_SIZE).toBe(8)
    expect(MAX_FONT_SIZE).toBe(40)
  })

  it('clamps to the allowed range and rounds to integers', () => {
    expect(clampFontSize(5)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(50)).toBe(MAX_FONT_SIZE)
    expect(clampFontSize(16)).toBe(16)
    expect(clampFontSize(14.5)).toBe(15)
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE)
    expect(clampFontSize(Infinity)).toBe(MAX_FONT_SIZE)
  })

  it('parses localStorage values, falling back to default on invalid input', () => {
    expect(parseFontSize(null)).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('16')).toBe(16)
    expect(parseFontSize('')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('abc')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('100')).toBe(MAX_FONT_SIZE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/font-size.test.ts`
Expected: FAIL — "Cannot find module '../../src/renderer/src/font'".

- [ ] **Step 3: Implement `src/renderer/src/font.ts` (pure helpers only)**

```ts
export const DEFAULT_FONT_SIZE = 14
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 40
export const FONT_SIZE_STORAGE_KEY = 'meow.fontSize'
export const FONT_SIZE_CHANGE_EVENT = 'meow:fontsize'

/** Round to an integer and clamp to the allowed range (8–40px). */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  const rounded = Math.round(size)
  if (rounded < MIN_FONT_SIZE) return MIN_FONT_SIZE
  if (rounded > MAX_FONT_SIZE) return MAX_FONT_SIZE
  return rounded
}

/** Parse a raw localStorage string; fall back to the default when invalid. */
export function parseFontSize(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_FONT_SIZE
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE
  return clampFontSize(n)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/font-size.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/font.ts tests/unit/font-size.test.ts
git commit -m "feat(font): add pure font-size helper + unit tests"
```

---

### Task 2: DOM apply/set/watch helpers + startup wiring

**Files:**
- Modify: `src/renderer/src/font.ts`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: the pure helpers from Task 1.
- Produces:
  - `getFontSize(): number`
  - `applyFontSize(size?: number): number`
  - `setFontSize(size: number): number`
  - `watchFontSize(onChange?: (size: number) => void): () => void`
  - Dispatches `FONT_SIZE_CHANGE_EVENT` on `window` (detail = resolved size) whenever the size changes.

- [ ] **Step 1: Add DOM helpers to `font.ts`**

Append to `src/renderer/src/font.ts`:

```ts
/** Read the current size from localStorage (default 14). */
export function getFontSize(): number {
  return parseFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
}

/**
 * Apply the size to <html> (and force <body> to follow the root) and notify
 * listeners via a CustomEvent so same-window terminals re-fit live. The
 * `storage` event only fires across windows, not in the window that wrote it,
 * so the CustomEvent is required for in-window live updates.
 */
export function applyFontSize(size?: number): number {
  const resolved = clampFontSize(size ?? getFontSize())
  document.documentElement.style.fontSize = `${resolved}px`
  document.body.style.fontSize = '1rem'
  window.dispatchEvent(new CustomEvent(FONT_SIZE_CHANGE_EVENT, { detail: resolved }))
  return resolved
}

/** Persist to localStorage and apply. Returns the resolved (clamped) size. */
export function setFontSize(size: number): number {
  const resolved = clampFontSize(size)
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(resolved))
  return applyFontSize(resolved)
}

/** Re-apply on `storage` events (other renderers/popups). */
export function watchFontSize(onChange?: (size: number) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== FONT_SIZE_STORAGE_KEY) return
    const size = applyFontSize()
    onChange?.(size)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
```

- [ ] **Step 2: Wire into `main.tsx`**

In `src/renderer/src/main.tsx`, follow the existing theme pattern. Add the import and call `applyFontSize()` + `watchFontSize()` right after `applyTheme()`/`watchTheme()` (before first paint):

```ts
import { applyTheme, watchTheme } from './theme'
import { applyFontSize, watchFontSize } from './font'
```

and after `watchTheme()`:

```ts
// Applied before first paint so popups (Git viewer / FileViewer) inherit the
// persisted font size, and re-applied when the main window changes it.
applyFontSize()
watchFontSize()
```

- [ ] **Step 3: Run existing tests to ensure nothing broke**

Run: `npx vitest run tests/unit/font-size.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/font.ts src/renderer/src/main.tsx
git commit -m "feat(font): wire applyFontSize/watchFontSize into renderer startup"
```

---

### Task 3: Personalize tab in the Settings dialog

**Files:**
- Create: `src/renderer/src/components/settings/PersonalizeTab.tsx`
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx`
- Modify: `src/renderer/src/styles.css` (add small layout styles)

**Interfaces:**
- Consumes: `getFontSize`, `setFontSize`, `clampFontSize`, `DEFAULT_FONT_SIZE`, `MIN_FONT_SIZE`, `MAX_FONT_SIZE` from `../../font`.
- Produces: the `PersonalizeTab` component (no props); a new `TabId` value `'personalize'`.

- [ ] **Step 1: Create `PersonalizeTab.tsx`** (reuse the existing `.settings-section` / `.settings-section-header` / `.label` / `.settings-hint` classes used by `ContextTab.tsx`; do NOT define new classes):

```tsx
import { useState } from 'react'
import {
  DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, getFontSize, setFontSize, clampFontSize
} from '../../font'

export default function PersonalizeTab() {
  const [size, setSize] = useState<number>(() => getFontSize())
  const [input, setInput] = useState<string>(() => String(getFontSize()))

  const commit = (raw: string) => {
    setInput(raw)
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return
    const resolved = setFontSize(n)
    setSize(resolved)
    setInput(String(resolved))
  }

  const step = (delta: number) => commit(String(clampFontSize(size + delta)))

  return (
    <section className="settings-section">
      <h4 className="settings-section-header">Personalize</h4>
      <label className="label" htmlFor="fontSize">Font size (px)</label>
      <div className="font-size-row">
        <button className="btn" onClick={() => step(-1)} aria-label="Decrease font size">−</button>
        <input
          id="fontSize"
          className="font-size-input"
          type="text"
          inputMode="numeric"
          value={input}
          onChange={e => commit(e.target.value)}
        />
        <button className="btn" onClick={() => step(1)} aria-label="Increase font size">+</button>
      </div>
      <p className="settings-hint">
        Range {MIN_FONT_SIZE}–{MAX_FONT_SIZE}px. Default {DEFAULT_FONT_SIZE}px.
      </p>
      <div>
        <button className="btn" onClick={() => commit(String(DEFAULT_FONT_SIZE))}>
          Reset to {DEFAULT_FONT_SIZE}
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add the new `font-size-row` / `font-size-input` styles only**

`styles.css` is CRLF — `.settings-section`, `.settings-section-header`, `.label`, `.settings-hint` already exist, so only add the two truly-new classes. Use a python one-liner if the edit tool cannot match (these lines exist near the `.settings-*` block, e.g. after line 1201):

```css
.font-size-row { display: flex; gap: 8px; align-items: center; }
.font-size-input { width: 72px; text-align: center; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Register the tab in `SettingsDialog.tsx`**

Update the `TabId` type and `TABS` array, and render `PersonalizeTab`:

```ts
export type TabId = 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'templates' | 'updates' | 'providers' | 'personalize'
```

Add to `TABS`:

```ts
{ id: 'personalize', label: 'Personalize' }
```

Add the import:

```ts
import PersonalizeTab from './PersonalizeTab'
```

Add a render branch (after the `updates` branch, before the closing `</div>` of `.settings-content`):

```tsx
{tab === 'personalize' && <PersonalizeTab />}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig/web.json`
Expected: no type errors (PersonalizeTab's imports resolve; `TabId` includes the new value).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/PersonalizeTab.tsx src/renderer/src/components/settings/SettingsDialog.tsx src/renderer/src/styles.css
git commit -m "feat(settings): add Personalize tab with font size control"
```

---

### Task 4: Scale the xterm terminal

**Files:**
- Modify: `src/renderer/src/components/XtermHost.tsx`

**Interfaces:**
- Consumes: `getFontSize`, `FONT_SIZE_STORAGE_KEY`, `FONT_SIZE_CHANGE_EVENT` from `../../font`.
- Produces: none (terminal re-fits internally).

- [ ] **Step 1: Update `XtermHost.tsx`**

Add the import at the top:

```ts
import { getFontSize, FONT_SIZE_STORAGE_KEY, FONT_SIZE_CHANGE_EVENT } from '../../font'
```

Set the initial `fontSize` from the persisted size instead of a hardcoded `14`:

```ts
const term = new Terminal({
  ...
  fontSize: getFontSize(),
  ...
})
```

Add a helper inside the `useEffect` (after `term.onResize`):

```ts
const applyFontSize = () => {
  term.options.fontSize = getFontSize()
  try { fit.fit() } catch { /* RO will self-correct */ }
}
```

Add a listener for the in-window CustomEvent (fires when the user edits the setting in this window):

```ts
const onFontSizeChange = () => applyFontSize()
window.addEventListener(FONT_SIZE_CHANGE_EVENT, onFontSizeChange)
```

Extend the existing theme `storage` listener to also handle the font key (for other renderers/popups). Replace the existing `onStorage` body:

```ts
const onStorage = (e: StorageEvent) => {
  if (e.key === 'meow.theme') {
    term.options.theme = document.documentElement.getAttribute('data-theme') === 'light' ? LIGHT_THEME : DARK_THEME
  } else if (e.key === FONT_SIZE_STORAGE_KEY) {
    applyFontSize()
  }
}
```

Update the cleanup to remove the new listener:

```ts
window.removeEventListener(FONT_SIZE_CHANGE_EVENT, onFontSizeChange)
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig/web.json`
Expected: no type errors (`term.options.fontSize` accepts a number; `fit` is in scope).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/XtermHost.tsx
git commit -m "feat(xterm): scale terminal font size with app preference"
```

---

### Task 5: Documentation sync + full verification

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/AGENTS.md`
- Modify: `src/renderer/src/components/AGENTS.md`
- Modify: `src/renderer/src/components/settings/AGENTS.md`

- [ ] **Step 1: Update `docs/reference/09-ui-guide.md`**

In section **9.6 Theming**, add a bullet (after the `watchTheme` bullet):

```
- App-wide font size persists in `localStorage` under `meow.fontSize` (default 14, range 8–40px,
  integer). `applyFontSize()` in `font.ts` sets `font-size` on `<html>`/`<body>` and dispatches a
  `meow:fontsize` CustomEvent so open xterm terminals re-`fit()` live; `watchFontSize()` re-applies
  on `storage` events across same-origin popups. The control lives in the Settings → Personalize tab.
```

- [ ] **Step 2: Update module `AGENTS.md` files (only the affected entries)**

  - `src/renderer/AGENTS.md` — in the file list, add `src/font.ts` (font-size helpers mirroring
    `theme.ts`). Under the theme conventions line describing `theme.ts`, note the font preference too.
  - `src/renderer/src/components/AGENTS.md` — in the `XtermHost.tsx` row, add "scales its font size
    with the app's `meow.fontSize` preference".
  - `src/renderer/src/components/settings/AGENTS.md` — add a `PersonalizeTab.tsx` row to the key-files
    table.

- [ ] **Step 3: Run the full required test gates**

Run:
```bash
npm run typecheck
npm test
```

Expected: both pass.

- [ ] **Step 4: Manual smoke (dev)**

Run `npm run dev`, open Settings → Personalize, change the font size:
- UI text scales immediately (chat, sidebar, buttons).
- The terminal font scales and re-flows.
- `Reset to 14` restores default.
- Reload the app — the size persists.
- Toggle it again — open terminal updates live.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/09-ui-guide.md src/renderer/AGENTS.md src/renderer/src/components/AGENTS.md src/renderer/src/components/settings/AGENTS.md
git commit -m "docs: document personalize font-size preference and terminal scaling"
```
