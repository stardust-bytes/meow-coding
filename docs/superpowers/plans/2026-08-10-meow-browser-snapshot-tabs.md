# Browser Snapshot (ARIA tree + refs) & Tab Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser element finding fast and stable (ARIA tree snapshot + ref-based interaction like Playwright `ariaSnapshot`), never open new Chrome windows from LLM actions (background tabs in existing windows), group Meow-opened tabs under a "Meow" tab group, and support full-page screenshots of background tabs without stealing focus.

**Architecture:** Content script builds a nested ARIA tree using `getComputedRole()`/`getComputedName()` (no layout) with `ref` handles on interactive nodes; a ref→element map in the content script resolves `click/type/select` by ref. Background service worker tracks a "working tab", opens background tabs in existing windows, groups them via `chrome.tabGroups`, and captures screenshots via `chrome.debugger` CDP `Page.captureScreenshot`. Main-process tools pass refs through unchanged.

**Tech Stack:** Chrome MV3 extension (TS, esbuild → `out/browser-extension`), `@types/chrome`, Vitest (node env, fake DOM objects), main-process zod tools.

**Spec:** `docs/superpowers/specs/2026-08-10-meow-browser-snapshot-tabs-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/browser-types.ts` | Add `SnapshotNode`, `BrowserTabInfo` types |
| `src/browser-extension/manifest.json` | Add `debugger`, `tabGroups` permissions; bump version to 0.2.0 |
| `src/browser-extension/snapshot.ts` (new) | Pure ARIA tree builder: `buildAriaTree`, `fallbackRole`, `fallbackName`, `createRefMap`, `resolveRef` — no DOM/global side effects, unit-testable |
| `src/browser-extension/content.ts` | Use `buildAriaTree` in `read`; ref-based `click/type/select`; hold ref map |
| `src/browser-extension/background.ts` | Working tab, openTab (window reuse + "Meow" group), listTabs group info, switchTab, CDP screenshot |
| `src/main/agent/tools/browser.ts` | Tools: add `ref` params, new `browser_open_tab`, update descriptions |
| `src/main/browser/chrome-launcher.ts` | Drop `--new-window` when spawning Chrome |
| `tests/unit/browser/snapshot.test.ts` (new) | Unit tests for snapshot.ts (fake DOM objects) |
| `tests/unit/browser/agent-tools-browser.test.ts` | Update tool count + add ref/open_tab/read tests |

Note: `tests/**` are NOT in `tsconfig.node.json` (typecheck covers node/web/extension only; tests run under Vitest/esbuild). `snapshot.ts` is typechecked by `tsconfig.extension.json` (lib `DOM` + `chrome`).

---

## Task 1: Shared types + manifest

**Files:**
- Modify: `src/shared/browser-types.ts`
- Modify: `src/browser-extension/manifest.json`

- [ ] **Step 1: Add snapshot + tab types**

Add to `src/shared/browser-types.ts` (after `BrowserStatusInfo`, before `BrowserCommandName`):

```ts
export interface SnapshotNode {
  role: string
  name?: string
  ref?: string
  children?: SnapshotNode[]
}

export interface BrowserTabInfo {
  id?: number
  title?: string
  url?: string
  active: boolean
  windowId?: number
  groupId?: number
  groupTitle?: string
}
```

- [ ] **Step 2: Update manifest permissions + version**

In `src/browser-extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Meow Browser Bridge",
  "version": "0.2.0",
  "description": "Bridge giữa Meow Coding và Chrome: cho phép agent đọc/thao tác trang trên profile Chrome thật.",
  "permissions": ["tabs", "scripting", "storage", "debugger", "tabGroups"],
  ...
}
```

(Only `version` and `permissions` change; keep the rest of the file as-is.)

- [ ] **Step 3: Verify typecheck + extension build**

Run: `npm run typecheck` and `npm run build:extension`
Expected: both pass; `out/browser-extension/manifest.json` shows `"version": "0.2.0"` and the 5 permissions.

- [ ] **Step 4: Commit**

```bash
git add src/shared/browser-types.ts src/browser-extension/manifest.json
git commit -m "feat(browser): snapshot types + tabGroups/debugger permissions"
```

---

## Task 2: ARIA tree builder (pure module) — TDD

**Files:**
- Create: `src/browser-extension/snapshot.ts`
- Test: `tests/unit/browser/snapshot.test.ts`

Design: pure functions, no `document`/`window`/`chrome` globals at call time. Real DOM in Chrome provides `getComputedRole`/`getComputedName`; tests use fake objects. Text-node and element-node constants are local (Node.js has no global `Node`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/browser/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildAriaTree, resolveRef, createRefMap, fallbackRole } from '../../../src/browser-extension/snapshot'

interface FakeNode {
  tagName: string
  nodeType: number
  getAttribute: (name: string) => string | null
  textContent: string | null
  childNodes: FakeNode[]
  hidden?: boolean
  style?: { display?: string; visibility?: string }
  isConnected?: boolean
  getComputedRole?: () => string
  getComputedName?: () => string
  value?: string
}

const TEXT = 3
const ELEMENT = 1

function makeEl(tag: string, attrs: Record<string, string> = {}, children: FakeNode[] = [], opts: Partial<FakeNode> = {}): FakeNode {
  return {
    tagName: tag.toUpperCase(),
    nodeType: ELEMENT,
    getAttribute: (name) => attrs[name] ?? null,
    textContent: opts.textContent ?? null,
    childNodes: children,
    hidden: opts.hidden,
    style: opts.style,
    isConnected: opts.isConnected ?? true,
    ...(opts.getComputedRole ? { getComputedRole: opts.getComputedRole } : {}),
    ...(opts.getComputedName ? { getComputedName: opts.getComputedName } : {}),
    ...(opts.value != null ? { value: opts.value } : {})
  }
}

function makeText(text: string): FakeNode {
  return { tagName: '', nodeType: TEXT, getAttribute: () => null, textContent: text, childNodes: [] }
}

describe('buildAriaTree', () => {
  it('assigns refs to interactive elements and resolves them', () => {
    const body = makeEl('body', {}, [
      makeEl('nav', {}, [
        makeEl('a', {}, [], { textContent: 'Docs' })
      ]),
      makeEl('button', { 'aria-label': 'Chat' }),
      makeEl('input', { type: 'text' })
    ])
    const { tree, refs } = buildAriaTree(body as unknown as Element, {})
    expect(refs.length).toBe(3)
    const names = refs.map(r => r.ref)
    expect(names).toEqual(['r1', 'r2', 'r3'])
    const map = createRefMap(refs)
    expect(resolveRef('r2', map)).toBe(refs[1].el)
    expect(resolveRef('r99', map)).toBeNull()
  })

  it('uses getComputedRole/Name when present, falls back to attributes', () => {
    const btn = makeEl('div', { 'aria-label': 'Send' }, [], {
      getComputedRole: () => 'button',
      getComputedName: () => 'Send'
    })
    const { tree } = buildAriaTree(btn as unknown as Element, {})
    expect(tree[0]).toMatchObject({ role: 'button', name: 'Send', ref: 'r1' })
  })

  it('derives role/name from tag + text fallback for links and buttons', () => {
    const link = makeEl('a', {}, [], { textContent: '  Docs  ' })
    const { tree } = buildAriaTree(link as unknown as Element, {})
    expect(tree[0]).toMatchObject({ role: 'link', name: 'Docs', ref: 'r1' })
  })

  it('includes text children as text nodes', () => {
    const div = makeEl('div', {}, [
      makeText('  Welcome to Acme  '),
      makeEl('button', { 'aria-label': 'Sign up' })
    ])
    const { tree } = buildAriaTree(div as unknown as Element, {})
    const children = tree[0].children!
    expect(children[0]).toEqual({ role: 'text', name: 'Welcome to Acme' })
    expect(children[1]).toMatchObject({ role: 'button', ref: 'r1' })
  })

  it('skips hidden elements and script/style/template', () => {
    const body = makeEl('body', {}, [
      makeEl('div', {}, [], { hidden: true }),
      makeEl('script'),
      makeEl('style'),
      makeEl('button', { 'aria-label': 'Visible' })
    ])
    const { tree, refs } = buildAriaTree(body as unknown as Element, {})
    expect(refs).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
  })

  it('drops generic containers with no children and no name', () => {
    const div = makeEl('div')
    const { tree } = buildAriaTree(div as unknown as Element, {})
    expect(tree).toHaveLength(0)
  })

  it('caps nodes via maxNodes (0 = unlimited)', () => {
    const buttons = Array.from({ length: 300 }, (_, i) => makeEl('button', { 'aria-label': `b${i}` }))
    const body = makeEl('body', {}, buttons)
    const { tree, refs } = buildAriaTree(body as unknown as Element, { maxNodes: 200 })
    expect(refs.length).toBeLessThanOrEqual(200)
    const { tree: unlimited } = buildAriaTree(body as unknown as Element, { maxNodes: 0 })
    expect(unlimited[0].children!.length).toBe(300)
  })
})

describe('fallbackRole', () => {
  it('maps native tags to roles', () => {
    expect(fallbackRole(makeEl('button') as unknown as Element)).toBe('button')
    expect(fallbackRole(makeEl('a') as unknown as Element)).toBe('link')
    expect(fallbackRole(makeEl('select') as unknown as Element)).toBe('combobox')
    expect(fallbackRole(makeEl('input', { type: 'checkbox' }) as unknown as Element)).toBe('checkbox')
    expect(fallbackRole(makeEl('input', { type: 'range' }) as unknown as Element)).toBe('slider')
    expect(fallbackRole(makeEl('nav') as unknown as Element)).toBe('navigation')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/snapshot.test.ts`
Expected: FAIL with "Failed to resolve import ... snapshot" (module doesn't exist yet).

- [ ] **Step 3: Implement snapshot.ts**

Create `src/browser-extension/snapshot.ts`:

```ts
import type { SnapshotNode } from '../../src/shared/browser-types'

export const DEFAULT_MAX_NODES = 200
const TEXT_NODE = 3
const ELEMENT_NODE = 1

export interface SnapshotRef {
  ref: string
  el: Element
}

export interface BuildAriaTreeOptions {
  maxNodes?: number
  textMaxChars?: number
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio',
  'switch', 'combobox', 'listbox', 'option', 'tab', 'textbox', 'searchbox', 'spinbutton',
  'slider', 'treeitem', 'gridcell', 'scrollbar'
])
const GENERIC_ROLES = new Set(['generic', 'none', 'presentation'])
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])

interface A11yElementLike {
  getComputedRole?: () => string
  getComputedName?: () => string
}

export function fallbackRole(el: Element): string {
  const role = el.getAttribute('role')
  if (role) return role
  const tag = el.tagName.toLowerCase()
  if (tag === 'a' || tag === 'area') return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'img') return 'img'
  if (tag === 'nav') return 'navigation'
  if (tag === 'form') return 'form'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'range') return 'slider'
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  return 'generic'
}

export function fallbackName(el: Element, useText = false): string {
  const attr = (n: string): string => el.getAttribute(n) ?? ''
  const ariaLabel = attr('aria-label')
  if (ariaLabel) return ariaLabel
  const alt = attr('alt')
  if (alt) return alt
  const placeholder = attr('placeholder')
  if (placeholder) return placeholder
  const value = (el as HTMLInputElement).value
  if (value) return value
  const title = attr('title')
  if (title) return title
  if (useText) return (el.textContent ?? '').trim()
  return ''
}

export function buildAriaTree(
  root: Element,
  opts: BuildAriaTreeOptions = {}
): { tree: SnapshotNode[]; refs: SnapshotRef[] } {
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES
  const textMaxChars = opts.textMaxChars ?? 80
  const refs: SnapshotRef[] = []
  let count = 0
  let refCounter = 0

  const visit = (el: Element): SnapshotNode | null => {
    if (count >= maxNodes) return null
    if (SKIPPED_TAGS.has(el.tagName)) return null
    if (el.getAttribute('aria-hidden') === 'true') return null
    const style = (el as HTMLElement).style
    if ((el as HTMLElement).hidden || style?.display === 'none' || style?.visibility === 'hidden') return null

    const a11y = el as Element & A11yElementLike
    const role = a11y.getComputedRole?.() ?? fallbackRole(el)
    const isGeneric = GENERIC_ROLES.has(role)
    const interactive =
      INTERACTIVE_ROLES.has(role) ||
      el.tagName === 'INPUT' ||
      el.tagName === 'SELECT' ||
      el.tagName === 'TEXTAREA'
    const useTextName = interactive || role === 'heading' || role === 'link'

    const children: SnapshotNode[] = []
    for (const child of Array.from(el.childNodes)) {
      if (count >= maxNodes) break
      if (child.nodeType === TEXT_NODE) {
        const t = (child.textContent ?? '').trim().replace(/\s+/g, ' ')
        if (t) children.push({ role: 'text', name: t.slice(0, textMaxChars) })
      } else if (child.nodeType === ELEMENT_NODE) {
        const n = visit(child as Element)
        if (n) children.push(n)
      }
    }

    const rawName = a11y.getComputedName?.()
    const name = (rawName ?? fallbackName(el, useTextName)).trim().replace(/\s+/g, ' ').slice(0, textMaxChars)

    if (isGeneric && !interactive && children.length === 0 && !name) return null
    if (count >= maxNodes) return null
    count++
    let ref: string | undefined
    if (interactive) {
      refCounter++
      ref = `r${refCounter}`
      refs.push({ ref, el })
    }
    return {
      role,
      ...(name ? { name } : {}),
      ...(ref ? { ref } : {}),
      ...(children.length ? { children } : {})
    }
  }

  const rootNode = visit(root)
  return { tree: rootNode ? [rootNode] : [], refs }
}

export function createRefMap(refs: SnapshotRef[]): Map<string, Element> {
  return new Map(refs.map(r => [r.ref, r.el]))
}

export function resolveRef(ref: string, map: Map<string, Element>): Element | null {
  const el = map.get(ref)
  if (el && (el as Element & { isConnected?: boolean }).isConnected !== false) return el
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/browser/snapshot.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (extension tsconfig includes `src/browser-extension/snapshot.ts`; note `src/shared/browser-types.ts` is in the extension include list already).

- [ ] **Step 6: Commit**

```bash
git add src/browser-extension/snapshot.ts tests/unit/browser/snapshot.test.ts
git commit -m "feat(browser-extension): aria snapshot builder with refs (getComputedRole/Name, no layout)"
```

---

## Task 3: Content script — read snapshot + ref-based interaction

**Files:**
- Modify: `src/browser-extension/content.ts`

Wiring only — the tree logic was TDD'd in Task 2. Verified via `npm run build:extension` + typecheck + manual checks.

- [ ] **Step 1: Import snapshot helpers and add ref map state**

At the top of `src/browser-extension/content.ts` (replace the existing import):

```ts
import type { BrowserCommandName } from '../../src/shared/browser-types'
import { buildAriaTree, createRefMap, resolveRef, DEFAULT_MAX_NODES } from './snapshot'
```

After the constants (`MAX_READ_CHARS`, `MAX_ELEMENTS`), add the module-level ref map (keep `MAX_ELEMENTS` removed — replaced by `DEFAULT_MAX_NODES`):

```ts
const MAX_READ_CHARS = 12000

let refMap = new Map<string, Element>()
```

- [ ] **Step 2: Replace `collectInteractive` with nothing (remove it) and rewrite `read`**

Delete the whole `collectInteractive` function (lines ~62–75). Rewrite the `read` case:

```ts
case 'read': {
  const root = params.selector != null ? query(String(params.selector)) : document.body
  if (!root) return { ok: false, error: `selector not found: ${params.selector}` }
  const raw = Number(params.maxElements)
  const maxNodes = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_MAX_NODES
  const { tree, refs } = buildAriaTree(root, { maxNodes })
  refMap = createRefMap(refs)
  const rootText = 'innerText' in root ? String(root.innerText) : root.textContent ?? ''
  const text = (rootText || '').replace(/\n{3,}/g, '\n\n').trim()
  const truncated = text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) + '\n...(truncated)' : text
  return {
    ok: true,
    data: { url: location.href, title: document.title, text: truncated, tree }
  }
}
```

- [ ] **Step 3: Add ref resolution to click/type/select**

`click` (insert `ref` handling before `selector`):

```ts
case 'click': {
  if (params.ref != null) {
    const el = resolveRef(String(params.ref), refMap)
    if (!el) return { ok: false, error: `snapshot stale: re-read the page (ref ${params.ref} no longer valid)` }
    scrollIntoView(el)
    ;(el as HTMLElement).click()
    return { ok: true, data: { ref: params.ref } }
  }
  if (params.selector != null) {
    const el = query(String(params.selector))
    if (!el) return { ok: false, error: `selector not found: ${params.selector}` }
    scrollIntoView(el)
    ;(el as HTMLElement).click()
    return { ok: true, data: { selector: params.selector } }
  }
  if (params.x != null && params.y != null) {
    const el = document.elementFromPoint(Number(params.x), Number(params.y))
    if (!el) return { ok: false, error: `no element at (${params.x}, ${params.y})` }
    ;(el as HTMLElement).click()
    return { ok: true, data: { x: params.x, y: params.y } }
  }
  return { ok: false, error: 'click requires ref, selector or x/y' }
}
```

`type`:

```ts
case 'type': {
  if (params.ref == null && params.selector == null) return { ok: false, error: 'type requires ref or selector' }
  const el = params.ref != null ? resolveRef(String(params.ref), refMap) : query(String(params.selector))
  if (!el) return { ok: false, error: params.ref != null ? `snapshot stale: re-read the page (ref ${params.ref})` : `selector not found: ${params.selector}` }
  const text = String(params.text ?? '')
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.focus()
    setNativeValue(el, text)
  } else {
    ;(el as HTMLElement).focus()
    el.textContent = text
  }
  return { ok: true }
}
```

`select`:

```ts
case 'select': {
  if (params.ref == null && params.selector == null) return { ok: false, error: 'select requires ref or selector' }
  const el = params.ref != null ? resolveRef(String(params.ref), refMap) : query(String(params.selector))
  if (!el) return { ok: false, error: params.ref != null ? `snapshot stale: re-read the page (ref ${params.ref})` : `selector not found: ${params.selector}` }
  const select = el as HTMLSelectElement
  select.value = String(params.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
}
```

- [ ] **Step 4: Verify typecheck + extension build**

Run: `npm run typecheck` and `npm run build:extension`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/browser-extension/content.ts
git commit -m "feat(browser-extension): read returns aria tree with refs; click/type/select resolve by ref"
```

---

## Task 4: Background — working tab, tab groups, CDP screenshot

**Files:**
- Modify: `src/browser-extension/background.ts`

Verified via `npm run typecheck` + `npm run build:extension` + manual checks (background tab behavior needs a real Chrome; no unit test harness exists for this file — matches existing repo convention).

- [ ] **Step 1: Add group constants + working tab state**

After the existing module-level state in `background.ts` (after `let pendingCode`), add:

```ts
const GROUP_TITLE = 'Meow'
const GROUP_COLOR = 'blue' as chrome.tabGroups.ColorEnum

let workingTabId: number | null = null
```

- [ ] **Step 2: Add helpers for window reuse, group, and default tab**

Insert these functions after `activeTabId()`:

```ts
async function lastFocusedWindowId(): Promise<number | undefined> {
  const wins = await chrome.windows.getAll({})
  if (wins.length === 0) return undefined
  const focused = wins.find(w => w.focused)
  if (focused?.id != null) return focused.id
  const byFocus = [...wins].sort(
    (a, b) => ((b as Window & { lastFocused?: number }).lastFocused ?? 0) - ((a as Window & { lastFocused?: number }).lastFocused ?? 0)
  )
  return byFocus[0]?.id
}

async function meowGroupId(): Promise<number | undefined> {
  const groups = await chrome.tabGroups.query({})
  return groups.find(g => g.title === GROUP_TITLE)?.id
}

async function addToMeowGroup(tabId: number): Promise<{ groupId?: number; groupTitle?: string }> {
  const existing = await meowGroupId()
  const groupId = await chrome.tabs.group({ tabIds: [tabId], ...(existing != null ? { groupId: existing } : {}) })
  await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR })
  return { groupId, groupTitle: GROUP_TITLE }
}

async function defaultTabId(): Promise<number | undefined> {
  if (workingTabId != null) {
    try {
      const t = await chrome.tabs.get(workingTabId)
      return t.id
    } catch {
      workingTabId = null
    }
  }
  return activeTabId()
}
```

- [ ] **Step 3: Rewrite `openTab` (background tab, existing window, group) + set working tab**

```ts
case 'openTab': {
  const url = String(params.url ?? '')
  const windowId = await lastFocusedWindowId()
  const tab = windowId != null
    ? await chrome.tabs.create({ url, windowId, active: false })
    : await chrome.tabs.create({ url })
  workingTabId = tab.id ?? null
  const group = tab.id != null ? await addToMeowGroup(tab.id) : {}
  send({ ok: true, data: { id: tab.id, url: tab.url, ...group } })
  return
}
```

- [ ] **Step 4: Update `listTabs` to include group info and `switchTab` to set working tab**

`listTabs`:

```ts
case 'listTabs': {
  const tabs = await chrome.tabs.query({})
  const groupIds = [...new Set(tabs.map(t => t.groupId).filter((id): id is number => id != null))]
  const groupTitles = new Map<number, string>()
  for (const id of groupIds) {
    try {
      const g = await chrome.tabGroups.get(id)
      groupTitles.set(id, g.title ?? '')
    } catch {
      /* group closed between query and get */
    }
  }
  send({
    ok: true,
    data: tabs.map(t => ({
      id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId,
      groupId: t.groupId,
      groupTitle: t.groupId != null ? groupTitles.get(t.groupId) : undefined
    }))
  })
  return
}
```

`switchTab` (keep `active: true` only — no `windows.update(focused:true)`):

```ts
case 'switchTab': {
  const tabId = Number(params.tabId)
  const tab = await chrome.tabs.update(tabId, { active: true })
  workingTabId = tab?.id ?? null
  send({ ok: true, data: { id: tab?.id, url: tab?.url } })
  return
}
```

- [ ] **Step 5: Replace `screenshot` with CDP full-page capture of the working tab**

```ts
case 'screenshot': {
  const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
  if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable')
    const res = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true
    })
    await chrome.debugger.detach({ tabId })
    send({ ok: true, data: { base64: (res as { data: string }).data } })
  } catch (err) {
    await chrome.debugger.detach({ tabId }).catch(() => {})
    send({ ok: false, error: `screenshot failed (tab not capturable?): ${String(err)}` })
  }
  return
}
```

- [ ] **Step 6: Route default commands to the working tab**

In the `default:` branch of `handleCommand`, replace `await activeTabId()` with `await defaultTabId()`, and set `workingTabId` on success:

```ts
default: {
  const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
  if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
  const res = await sendToTab(tabId, name, params)
  if (res.ok) workingTabId = tabId
  send(res)
}
```

- [ ] **Step 7: Verify typecheck + extension build**

Run: `npm run typecheck` and `npm run build:extension`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/browser-extension/background.ts
git commit -m "feat(browser-extension): working tab, background openTab in existing window + Meow group, listTabs group info, CDP full-page screenshot"
```

---

## Task 5: Main-process tools (ref params, open_tab, descriptions)

**Files:**
- Modify: `src/main/agent/tools/browser.ts`
- Test: `tests/unit/browser/agent-tools-browser.test.ts`

- [ ] **Step 1: Update the failing tool test (15 tools + ref/open_tab)**

In `tests/unit/browser/agent-tools-browser.test.ts`, replace the "registers all 14 tools" test and add new tests:

```ts
  it('registers all 15 tools with names', () => {
    const tools = createBrowserTools(fakeBridge(), fakeLauncher())
    expect(tools.map(t => t.name)).toEqual([
      'browser_start', 'browser_navigate', 'browser_open_tab', 'browser_click', 'browser_type',
      'browser_select', 'browser_scroll', 'browser_read', 'browser_screenshot', 'browser_list_tabs',
      'browser_switch_tab', 'browser_close_tab', 'browser_console', 'browser_network', 'browser_wait_for'
    ])
  })
```

Add these tests after the existing `browser_navigate forwards the command to the bridge` test:

```ts
  it('browser_open_tab forwards the url to the bridge', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const openTab = tools.find(t => t.name === 'browser_open_tab')!
    const r = await openTab.run({ url: 'https://example.com' }, ctx)
    expect(r.output).toContain('openTab')
    expect(bridge.calls).toEqual([{ name: 'openTab', params: { url: 'https://example.com' } }])
  })

  it('browser_open_tab validates the url scheme', async () => {
    const tools = createBrowserTools(fakeBridge(), fakeLauncher())
    const openTab = tools.find(t => t.name === 'browser_open_tab')!
    const bad = await openTab.run({ url: 'ftp://x' }, ctx)
    expect(bad.error).toContain('invalid url')
  })
```

Update the existing `browser_click uses selector or coordinates` test to also cover ref:

```ts
  it('browser_click uses ref, selector or coordinates', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const click = tools.find(t => t.name === 'browser_click')!
    await click.run({ ref: 'r4' }, ctx)
    expect(bridge.calls[0]).toEqual({ name: 'click', params: { ref: 'r4' } })
    await click.run({ selector: '#btn' }, ctx)
    expect(bridge.calls[1]).toEqual({ name: 'click', params: { selector: '#btn' } })
    await click.run({ x: 10, y: 20 }, ctx)
    expect(bridge.calls[2]).toEqual({ name: 'click', params: { x: 10, y: 20 } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/agent-tools-browser.test.ts`
Expected: FAIL — `browser_open_tab` tool missing (and tool count mismatch).

- [ ] **Step 3: Implement tool changes in browser.ts**

Replace the `browser_click` tool:

```ts
    {
      name: 'browser_click',
      description: 'Click an element by snapshot ref (preferred), CSS selector, or viewport coordinates (x, y).',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read, e.g. r4.'),
        selector: z.string().optional().describe('CSS selector of the element to click.'),
        x: z.number().optional().describe('Viewport x coordinate (requires y).'),
        y: z.number().optional().describe('Viewport y coordinate (requires x).')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, x, y } = input as unknown as { ref?: string; selector?: string; x?: number; y?: number }
        if (ref != null) return fmt(await bridge.execute('click', { ref }))
        return fmt(await bridge.execute('click', selector ? { selector } : { x, y }))
      }
    },
```

Add the `browser_open_tab` tool right after `browser_navigate`:

```ts
    {
      name: 'browser_open_tab',
      description:
        'Open a URL in a new background tab of an existing Chrome window, grouped under "Meow". ' +
        'Never opens a new Chrome window unless none are open, and does not focus Chrome.',
      schema: z.object({
        url: z.string().describe('The http(s) URL to open.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { url } = input as unknown as { url: string }
        if (!/^https?:\/\//i.test(url)) return { error: `browser_open_tab: invalid url: ${url}` }
        return fmt(await bridge.execute('openTab', { url }))
      }
    },
```

Replace `browser_type` schema/run:

```ts
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the input element.'),
        text: z.string().describe('Text to type.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, text } = input as unknown as { ref?: string; selector?: string; text: string }
        return fmt(await bridge.execute('type', ref != null ? { ref, text } : { selector, text }))
      }
```

Replace `browser_select` schema/run:

```ts
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the select element.'),
        value: z.string().describe('Option value to select.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, value } = input as unknown as { ref?: string; selector?: string; value: string }
        return fmt(await bridge.execute('select', ref != null ? { ref, value } : { selector, value }))
      }
```

Replace `browser_read` description + schema (maxElements now means max tree nodes, default 200):

```ts
    {
      name: 'browser_read',
      description:
        'Return the page as a nested accessibility tree (role + accessible name per node) with refs ' +
        'on interactive elements, plus the visible text. Use a ref with browser_click/type/select. ' +
        'Pass maxElements to raise the tree node cap (default 200, use 0 for no limit).',
      schema: z.object({
        selector: z.string().optional().describe('Optional CSS selector; defaults to the whole page.'),
        maxElements: z.number().int().min(0).max(500).optional().describe('Max tree nodes; 0 means no limit (default 200).')
      }),
      async run(input): Promise<ToolRunResult> {
        const { selector, maxElements } = input as unknown as { selector?: string; maxElements?: number }
        return fmt(await bridge.execute('read', selector ? { selector, maxElements } : { maxElements }))
      }
    },
```

Update `browser_screenshot` description:

```ts
      description: 'Capture a full-page PNG of the working tab (background tabs supported) without switching tabs or focusing Chrome.',
```

Update `browser_list_tabs` description:

```ts
      description: 'List open tabs with id, title, url, active, window and tab-group info.',
```

Update `browser_switch_tab` description:

```ts
      description: 'Activate a tab by its id (from browser_list_tabs) without focusing the Chrome window.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/browser/agent-tools-browser.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/browser.ts tests/unit/browser/agent-tools-browser.test.ts
git commit -m "feat(agent): browser tools accept snapshot refs; add browser_open_tab"
```

---

## Task 6: Launcher — no new window when Chrome is running

**Files:**
- Modify: `src/main/browser/chrome-launcher.ts:22-35`

- [ ] **Step 1: Drop `--new-window`**

Replace the `openChrome` body's `spawn` call:

```ts
      if (executablePath) {
        spawn(executablePath, ['chrome://extensions'], {
          detached: true,
          stdio: 'ignore'
        }).unref()
        return
      }
```

(Removing `--new-window` means a running Chrome reuses an existing window; a fresh Chrome still opens a window, which is unavoidable.)

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/browser/chrome-launcher.ts
git commit -m "feat(browser): chrome launcher reuses existing window (drop --new-window)"
```

---

## Task 7: Docs + full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-meow-browser-snapshot-tabs-design.md` (note implementation refinements if any)

- [ ] **Step 1: Note the working-tab simplification in the spec**

The spec's §6 lists `tabId` on `browser_read`. The implementation instead relies on the **working tab** default (background sets `workingTabId` on open/read; commands without `tabId` target it). Update spec §6 to reflect this: read schema is `{selector?, maxElements?}` and targeting a specific tab happens via the working tab.

- [ ] **Step 2: Run full required checks**

Run: `npm run typecheck`, `npm test`, `npm run build:extension`
Expected: all pass (typecheck clean; 65+ test files pass; extension builds).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-meow-browser-snapshot-tabs-design.md
git commit -m "docs: note working-tab targeting in browser snapshot spec"
```

---

## Manual verification (after implementation)

1. `npm run dev` → pair extension (Reload it in `chrome://extensions` first — manifest changed to 0.2.0).
2. Agent: `browser_open_tab` a few URLs → confirm tabs open **in the existing Chrome window, in background, inside a "Meow" group** (colored blue), and no new window appears.
3. `browser_screenshot` a background tab → confirm a full-page PNG is saved and Chrome was not focused.
4. On a dynamic page (React app with an agent card): `browser_read` → the "Chat" button appears in the tree with a `[rN]` ref; `browser_click {ref}` works; `browser_read` feels fast (no per-element `innerText`).
5. `browser_switch_tab` → tab activates in its window, the OS focus stays on whatever the user was using.
