# Browser Deep Snapshot (CDP Accessibility tree + persistent debug session) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `browser_read` snapshot the full deep DOM (shadow DOM incl. closed roots, cross-origin iframes, offscreen) via CDP `Accessibility.getFullAXTree`, interact by ref→`backendDOMNodeId` (Puppeteer-style), and keep `chrome.debugger` attached for the whole working session so the debug infobar stops flickering.

**Architecture:** Background holds a persistent debug session (attach once + enable DOM/Page/Runtime/Accessibility, detach on tab-close/disconnect/idle). `read` runs CDP `Accessibility.getFullAXTree`, maps nodes to `SnapshotNode` via a pure `axTreeToSnapshot` module, and stores `ref→backendDOMNodeId`. `click/type/select` with `ref` resolve via `DOM.resolveNode` + `Runtime.callFunctionOn`; without `ref` they still route to the content script. The content script drops its own snapshot/ref logic; `snapshot.ts` is deleted.

**Tech Stack:** Chrome MV3 extension (TS, esbuild), `@types/chrome` (`chrome.debugger.sendCommand` is generic), Vitest (node env, fake objects + fake timers).

**Spec:** `docs/superpowers/specs/2026-08-10-meow-browser-deep-snapshot-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/browser-types.ts` | Add `export type BrowserReadMode = 'interactive' \| 'full'` |
| `src/browser-extension/ax-snapshot.ts` (new) | Pure: `axTreeToSnapshot(nodes, opts)` — CDP AX nodes → `{ tree: SnapshotNode[], refs: AxSnapshotRef[] }` |
| `src/browser-extension/debug-session.ts` (new) | Pure-ish: `createDebugSession(dbg, idleMs)` — attach-once/close/idle-timeout, testable with a fake debugger |
| `src/browser-extension/background.ts` | Wire debug session + CDP `read`/`screenshot`/ref-`click/type/select`; close session on disconnect/tab-close |
| `src/browser-extension/content.ts` | Remove `read` + ref paths + `refMap` + snapshot imports; keep selector/coords actions, scroll, waitFor, watch, console/network |
| `src/browser-extension/snapshot.ts` | **Delete** (dead code) |
| `src/main/agent/tools/browser.ts` | `browser_read` + `mode` param + description |
| `tests/unit/browser/ax-snapshot.test.ts` (new) | Unit tests for `axTreeToSnapshot` |
| `tests/unit/browser/debug-session.test.ts` (new) | Unit tests for `createDebugSession` |
| `tests/unit/browser/snapshot.test.ts` | **Delete** |
| `tests/unit/browser/agent-tools-browser.test.ts` | Add `mode` forwarding test for `browser_read` |

---

## Task 1: Shared type + `ax-snapshot.ts` (TDD)

**Files:**
- Modify: `src/shared/browser-types.ts`
- Create: `src/browser-extension/ax-snapshot.ts`
- Test: `tests/unit/browser/ax-snapshot.test.ts`

- [ ] **Step 1: Add `BrowserReadMode` to shared types**

In `src/shared/browser-types.ts`, after `BrowserStatusInfo` (before `BrowserCommandName`), add:

```ts
export type BrowserReadMode = 'interactive' | 'full'
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/browser/ax-snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { axTreeToSnapshot } from '../../../src/browser-extension/ax-snapshot'
import type { AxNodeLike } from '../../../src/browser-extension/ax-snapshot'

function axn(
  nodeId: string,
  opts: Partial<AxNodeLike> = {}
): AxNodeLike {
  return {
    nodeId,
    ignored: false,
    role: opts.role,
    name: opts.name,
    backendDOMNodeId: opts.backendDOMNodeId,
    childIds: opts.childIds,
    ignored: opts.ignored
  }
}

const role = (v: string): { value: string } => ({ value: v })
const name = (v: string): { value: string } => ({ value: v })

describe('axTreeToSnapshot', () => {
  it('builds a tree in childIds order and finds the root', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), backendDOMNodeId: 1, childIds: ['2', '3'] }),
      axn('2', { role: role('navigation'), name: name('Main'), childIds: ['4'] }),
      axn('3', { role: role('button'), name: name('Chat'), backendDOMNodeId: 7 }),
      axn('4', { role: role('link'), name: name('Docs'), backendDOMNodeId: 9 })
    ]
    const { tree, refs } = axTreeToSnapshot(nodes, {})
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root.role).toBe('rootwebarea')
    expect(root.children!.map(c => c.role)).toEqual(['navigation', 'button'])
    expect(root.children![0].children![0]).toMatchObject({ role: 'link', name: 'Docs' })
    // interactive mode: only button and link get refs
    expect(refs.map(r => r.ref)).toEqual(['r1', 'r2'])
    expect(refs[1].backendDOMNodeId).toBe(9)
  })

  it('normalizes role/name whether they are {value} objects or plain strings', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: 'button', name: 'Send', backendDOMNodeId: 3 }),
      axn('2', { role: 'rootwebarea' })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    const button = tree[0]
    expect(button.role).toBe('button')
    expect(button.name).toBe('Send')
  })

  it('skips ignored nodes', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2', '3'] }),
      axn('2', { role: role('generic'), ignored: true }),
      axn('3', { role: role('button'), name: name('Go'), backendDOMNodeId: 5 })
    ]
    const { tree, refs } = axTreeToSnapshot(nodes, {})
    expect(tree[0].children).toHaveLength(1)
    expect(refs).toHaveLength(1)
  })

  it('drops empty generic nodes in interactive mode but keeps them in full mode', () => {
    const generic = axn('2', { role: role('generic'), name: name(''), childIds: [] })
    const nodes: AxNodeLike[] = [axn('1', { role: role('rootwebarea'), childIds: ['2'] }), generic]
    const interactive = axTreeToSnapshot(nodes, { mode: 'interactive' })
    expect(interactive.tree[0].children).toHaveLength(0)
    const full = axTreeToSnapshot(nodes, { mode: 'full' })
    expect(full.tree[0].children).toHaveLength(1)
  })

  it('does not duplicate element name as a text child', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('button'), name: name('Chat'), childIds: ['3'] }),
      axn('3', { role: role('statictext'), name: name('Chat') })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    const button = tree[0].children![0]
    expect(button.name).toBe('Chat')
    expect(button.children).toBeUndefined()
  })

  it('renders static text as text nodes', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('paragraph'), childIds: ['3'] }),
      axn('3', { role: role('statictext'), name: name('  Hello  ') })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    expect(tree[0].children![0].children![0]).toEqual({ role: 'text', name: 'Hello' })
  })

  it('caps nodes via maxNodes (0 = unlimited) and truncates names', () => {
    const buttons = Array.from({ length: 300 }, (_, i) =>
      axn(`b${i}`, { role: role('button'), name: name(`Button ${i}`), backendDOMNodeId: 1000 + i }))
    const root = axn('1', { role: role('rootwebarea'), childIds: buttons.map(b => b.nodeId) })
    const capped = axTreeToSnapshot([root, ...buttons], { mode: 'full', maxNodes: 200 })
    expect(capped.refs.length).toBeLessThanOrEqual(200)
    const unlimited = axTreeToSnapshot([root, ...buttons], { mode: 'full', maxNodes: 0 })
    expect(unlimited.tree[0].children!.length).toBe(300)
    const truncated = axTreeToSnapshot(
      [root, axn('2', { role: role('button'), name: name('x'.repeat(200)), backendDOMNodeId: 5 })],
      { mode: 'interactive', textMaxChars: 10 }
    )
    expect(truncated.tree[0].children![0].name!.length).toBeLessThanOrEqual(10)
  })

  it('returns an empty tree for an empty node list', () => {
    expect(axTreeToSnapshot([])).toEqual({ tree: [], refs: [] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/ax-snapshot.test.ts`
Expected: FAIL — module `ax-snapshot` doesn't exist.

- [ ] **Step 4: Implement `ax-snapshot.ts`**

Create `src/browser-extension/ax-snapshot.ts`:

```ts
import type { SnapshotNode, BrowserReadMode } from '../../src/shared/browser-types'

export interface AxNodeLike {
  nodeId: string
  ignored?: boolean
  role?: { value?: string } | string
  name?: { value?: string } | string
  backendDOMNodeId?: number
  childIds?: string[]
}

export interface AxSnapshotRef {
  ref: string
  backendDOMNodeId: number
}

export interface AxToTreeOptions {
  mode?: BrowserReadMode
  maxNodes?: number
  textMaxChars?: number
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio',
  'switch', 'combobox', 'listbox', 'option', 'tab', 'textbox', 'searchbox', 'spinbutton',
  'slider', 'treeitem', 'gridcell', 'scrollbar'
])
const SKIPPED_ROLES = new Set(['generic', 'none', 'presentation'])
const TEXT_ROLES = new Set(['text', 'statictext', 'inlinetextbox'])

function axString(v: { value?: string } | string | undefined): string {
  return typeof v === 'string' ? v : (v?.value ?? '')
}

export function axTreeToSnapshot(
  nodes: AxNodeLike[],
  opts: AxToTreeOptions = {}
): { tree: SnapshotNode[]; refs: AxSnapshotRef[] } {
  const mode = opts.mode ?? 'interactive'
  const defaultMax = mode === 'full' ? 500 : 200
  const rawMax = opts.maxNodes ?? defaultMax
  const maxNodes = rawMax > 0 ? rawMax : Infinity
  const textMaxChars = opts.textMaxChars ?? 120

  const byId = new Map(nodes.map(n => [n.nodeId, n]))
  const isChild = new Set<string>()
  for (const n of nodes) for (const c of n.childIds ?? []) isChild.add(c)
  const root = nodes.find(n => !isChild.has(n.nodeId)) ?? nodes[0]
  if (!root) return { tree: [], refs: [] }

  const refs: AxSnapshotRef[] = []
  let count = 0
  let refCounter = 0

  const visit = (n: AxNodeLike): SnapshotNode | null => {
    if (maxNodes > 0 && count >= maxNodes) return null
    if (n.ignored) return null
    const role = axString(n.role).toLowerCase()
    const name = axString(n.name).trim().replace(/\s+/g, ' ').slice(0, textMaxChars)
    const textLike = TEXT_ROLES.has(role)
    const interactive = INTERACTIVE_ROLES.has(role)
    const skipRole = SKIPPED_ROLES.has(role)

    if (textLike) {
      if (!name) return null
      count++
      return { role: 'text', name }
    }

    count++

    const children: SnapshotNode[] = []
    for (const childId of n.childIds ?? []) {
      if (maxNodes > 0 && count >= maxNodes) break
      const c = byId.get(childId)
      if (!c) continue
      const cn = visit(c)
      if (cn) children.push(cn)
    }

    const kids = name ? children.filter(c => !(c.role === 'text' && c.name === name)) : children

    if (mode === 'interactive' && !interactive && skipRole && !name && kids.length === 0) {
      count--
      return null
    }

    let ref: string | undefined
    const wantRef = interactive || (mode === 'full' && n.backendDOMNodeId != null)
    if (wantRef && n.backendDOMNodeId != null) {
      refCounter++
      ref = `r${refCounter}`
      refs.push({ ref, backendDOMNodeId: n.backendDOMNodeId })
    }

    return {
      role,
      ...(name ? { name } : {}),
      ...(ref ? { ref } : {}),
      ...(kids.length ? { children: kids } : {})
    }
  }

  const rootNode = visit(root)
  return { tree: rootNode ? [rootNode] : [], refs }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/browser/ax-snapshot.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/browser-types.ts src/browser-extension/ax-snapshot.ts tests/unit/browser/ax-snapshot.test.ts
git commit -m "feat(browser): BrowserReadMode type + pure CDP AX-tree→snapshot mapper"
```

---

## Task 2: `debug-session.ts` (TDD)

**Files:**
- Create: `src/browser-extension/debug-session.ts`
- Test: `tests/unit/browser/debug-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/browser/debug-session.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createDebugSession } from '../../../src/browser-extension/debug-session'
import type { ChromeDebuggerLike } from '../../../src/browser-extension/debug-session'

function fakeDbg(): ChromeDebuggerLike & { attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn>; sendCommand: ReturnType<typeof vi.fn> } {
  return {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn().mockResolvedValue({})
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDebugSession', () => {
  it('attaches once and enables the four CDP domains', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    expect(dbg.attach).toHaveBeenCalledTimes(1)
    expect(dbg.attach).toHaveBeenCalledWith({ tabId: 10 }, '1.3')
    expect(dbg.sendCommand.mock.calls.map(c => c[1])).toEqual([
      'DOM.enable', 'Page.enable', 'Runtime.enable', 'Accessibility.enable'
    ])
    expect(session.attachedTabId()).toBe(10)
  })

  it('does not re-attach when ensuring the same tab', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.ensure(10)
    expect(dbg.attach).toHaveBeenCalledTimes(1)
  })

  it('closes the previous tab before attaching a new one', async () => {
    const dbg = fakeDbg()
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.ensure(20)
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
    expect(dbg.attach).toHaveBeenLastCalledWith({ tabId: 20 }, '1.3')
    expect(session.attachedTabId()).toBe(20)
  })

  it('close detaches and clears state; detach failure is swallowed', async () => {
    const dbg = fakeDbg()
    dbg.detach.mockRejectedValueOnce(new Error('no session'))
    const session = createDebugSession(dbg)
    await session.ensure(10)
    await session.close()
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
    expect(session.attachedTabId()).toBeNull()
  })

  it('closes itself after the idle timeout', async () => {
    vi.useFakeTimers()
    const dbg = fakeDbg()
    const session = createDebugSession(dbg, 1000)
    await session.ensure(10)
    expect(dbg.detach).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1001)
    await Promise.resolve()
    expect(dbg.detach).toHaveBeenCalledWith({ tabId: 10 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/debug-session.test.ts`
Expected: FAIL — module `debug-session` doesn't exist.

- [ ] **Step 3: Implement `debug-session.ts`**

Create `src/browser-extension/debug-session.ts`:

```ts
export interface DebuggeeLike {
  tabId?: number
}

export interface ChromeDebuggerLike {
  attach(target: DebuggeeLike, requiredVersion: string): Promise<void>
  detach(target: DebuggeeLike): Promise<void>
  sendCommand(target: DebuggeeLike, method: string, commandParams?: object): Promise<unknown>
}

export interface DebugSession {
  ensure(tabId: number): Promise<void>
  close(): Promise<void>
  attachedTabId(): number | null
}

export function createDebugSession(dbg: ChromeDebuggerLike, idleMs = 60_000): DebugSession {
  let debugTabId: number | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { void close() }, idleMs)
  }

  const close = async (): Promise<void> => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (debugTabId != null) {
      await dbg.detach({ tabId: debugTabId }).catch(() => {})
      debugTabId = null
    }
  }

  const ensure = async (tabId: number): Promise<void> => {
    if (debugTabId === tabId) {
      resetIdle()
      return
    }
    await close()
    await dbg.attach({ tabId }, '1.3')
    await Promise.all([
      dbg.sendCommand({ tabId }, 'DOM.enable'),
      dbg.sendCommand({ tabId }, 'Page.enable'),
      dbg.sendCommand({ tabId }, 'Runtime.enable'),
      dbg.sendCommand({ tabId }, 'Accessibility.enable')
    ])
    debugTabId = tabId
    resetIdle()
  }

  return {
    ensure,
    close,
    attachedTabId: () => debugTabId
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/browser/debug-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/browser-extension/debug-session.ts tests/unit/browser/debug-session.test.ts
git commit -m "feat(browser-extension): persistent chrome.debugger session with idle timeout"
```

---

## Task 3: Background — CDP read/screenshot/ref-actions + persistent session

**Files:**
- Modify: `src/browser-extension/background.ts`

- [ ] **Step 1: Imports + module state**

At the top of `background.ts`, add imports (keep the existing `BridgeToExtension`/`ExtensionToBridge` import):

```ts
import { createDebugSession } from './debug-session'
import { axTreeToSnapshot } from './ax-snapshot'
import type { AxNodeLike } from './ax-snapshot'
```

After the existing state block (after `let groupLock`), add:

```ts
const debugSession = createDebugSession(chrome.debugger)

let snapshotRefs = new Map<string, number>()
```

Note: `chrome.debugger` satisfies `ChromeDebuggerLike` (`attach`/`detach`/`sendCommand`).

- [ ] **Step 2: Add CDP helpers**

Insert these functions after `sendToTab`:

```ts
async function pageInnerText(tabId: number): Promise<string> {
  const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText : ""',
    returnByValue: true
  }) as { result?: { value?: string } }
  return String(res.result?.value ?? '')
}

async function callOnNode(backendNodeId: number, functionDeclaration: string, args: unknown[] = []): Promise<void> {
  const tabId = debugSession.attachedTabId()
  if (tabId == null) throw new Error('no debug session')
  const { object } = await chrome.debugger.sendCommand({ tabId }, 'DOM.resolveNode', { backendNodeId }) as { object: { objectId: string } }
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration,
    arguments: args.map(a => ({ value: a })),
    returnByValue: true
  })
}

async function refAction(name: string, params: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const ref = String(params.ref)
  const backendNodeId = snapshotRefs.get(ref)
  if (backendNodeId == null) {
    return { ok: false, error: `snapshot stale: re-read the page (ref ${ref} no longer valid)` }
  }
  if (name === 'click') {
    await callOnNode(backendNodeId, `function(){ const el = this; el.scrollIntoView({block:'center',inline:'center'}); el.click(); return true; }`)
    return { ok: true, data: { ref } }
  }
  if (name === 'type') {
    await callOnNode(backendNodeId,
      `function(text){ const el = this; el.focus(); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; if (setter) setter.call(el, text); else el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; }`,
      [String(params.text ?? '')])
    return { ok: true, data: { ref } }
  }
  await callOnNode(backendNodeId,
    `function(value){ const el = this; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }`,
    [String(params.value ?? '')])
  return { ok: true, data: { ref } }
}
```

- [ ] **Step 3: Rewrite the `screenshot` case to use the persistent session**

Replace the whole `screenshot` case in `handleCommand`:

```ts
      case 'screenshot': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        try {
          await debugSession.ensure(tabId)
          const res = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true, fromSurface: true
          })
          const data = (res as { data: string }).data
          if (!data) {
            send({ ok: false, error: 'screenshot failed: page produced no image (is the tab fully occluded?)' })
            return
          }
          persistWorkingTab(tabId)
          send({ ok: true, data: { base64: data } })
        } catch (err) {
          send({ ok: false, error: `screenshot failed (tab not capturable?): ${String(err)}` })
        }
        return
      }
```

- [ ] **Step 4: Add the `read` case (CDP AX snapshot)**

Insert this case into `handleCommand` before the `default:` case:

```ts
      case 'read': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        try {
          await debugSession.ensure(tabId)
        } catch (err) {
          send({ ok: false, error: `browser_read: page not CDP-accessible (${String(err)})` })
          return
        }
        const mode = params.mode === 'full' ? 'full' : 'interactive'
        const raw = Number(params.maxElements)
        const maxNodes = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : (mode === 'full' ? 500 : 200)
        const { nodes } = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree') as { nodes: unknown[] }
        const { tree, refs } = axTreeToSnapshot(nodes as AxNodeLike[], { mode, maxNodes })
        snapshotRefs = new Map(refs.map(r => [r.ref, r.backendDOMNodeId]))
        const [text, tab] = await Promise.all([
          pageInnerText(tabId).catch(() => ''),
          chrome.tabs.get(tabId)
        ])
        persistWorkingTab(tabId)
        send({ ok: true, data: { url: tab.url, title: tab.title, text, tree } })
        return
      }
```

- [ ] **Step 5: Add `click`/`type`/`select` cases (ref → CDP, else content script)**

Insert these cases into `handleCommand` before the `default:` case:

```ts
      case 'click':
      case 'type':
      case 'select': {
        if (params.ref != null) {
          const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
          if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
          try {
            await debugSession.ensure(tabId)
            const res = await refAction(name, params)
            if (res.ok) persistWorkingTab(tabId)
            send(res)
          } catch (err) {
            const ref = String(params.ref)
            send({ ok: false, error: `snapshot stale or page not CDP-accessible (ref ${ref}): ${String(err)}` })
          }
          return
        }
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        const res = await sendToTab(tabId, name, params)
        if (res.ok) persistWorkingTab(tabId)
        send(res)
        return
      }
```

- [ ] **Step 6: Close the debug session on disconnect / unpair / tab close**

(a) In `socket.onclose`, after `ws = null`, add:

```ts
      void debugSession.close()
```

(b) In `socket.onmessage` → `pair_result` branch, in the `else` (`msg.ok === false`) block, add:

```ts
        void debugSession.close()
```

(c) Add a tab-closed listener at the bottom of the file (before `connect()`):

```ts
chrome.tabs.onRemoved.addListener((tabId) => {
  if (debugSession.attachedTabId() === tabId) void debugSession.close()
})
```

- [ ] **Step 7: Verify typecheck + extension build**

Run: `npm run typecheck` and `npm run build:extension`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/browser-extension/background.ts
git commit -m "feat(browser-extension): CDP deep snapshot (Accessibility.getFullAXTree), ref actions, persistent debug session"
```

---

## Task 4: Content script cleanup + delete `snapshot.ts`

**Files:**
- Modify: `src/browser-extension/content.ts`
- Delete: `src/browser-extension/snapshot.ts`
- Delete: `tests/unit/browser/snapshot.test.ts`

- [ ] **Step 1: Remove snapshot imports and refMap state**

In `content.ts`, replace the import block:

```ts
import type { BrowserCommandName } from '../../src/shared/browser-types'
```

(Delete the second import line `import { buildAriaTree, createRefMap, resolveRef, DEFAULT_MAX_NODES } from './snapshot'`.)

Remove the `refMap` state and the `MAX_READ_CHARS` constant (grep confirms `MAX_READ_CHARS` is referenced only inside the removed `read` case):

```ts
const MAX_READ_CHARS = 12000

let refMap = new Map<string, Element>()
```

(Delete both lines.)

- [ ] **Step 2: Remove the `read` case**

Delete the entire `case 'read': { ... }` block from `execute` (it currently spans from `case 'read': {` through the closing `}` before `case 'waitFor':`).

- [ ] **Step 3: Strip ref handling from click/type/select**

Replace the `click` case with (ref path removed — CDP handles refs in the background):

```ts
    case 'click': {
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
      return { ok: false, error: 'click requires selector or x/y' }
    }
```

Replace the `type` case with (selector-only):

```ts
    case 'type': {
      if (params.selector == null) return { ok: false, error: 'type requires selector' }
      const el = query(String(params.selector))
      if (!el) return { ok: false, error: `selector not found: ${params.selector}` }
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

Replace the `select` case with (selector-only):

```ts
    case 'select': {
      if (params.selector == null) return { ok: false, error: 'select requires selector' }
      const el = query(String(params.selector))
      if (!el) return { ok: false, error: `selector not found: ${params.selector}` }
      const select = el as HTMLSelectElement
      select.value = String(params.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true }
    }
```

- [ ] **Step 4: Delete snapshot.ts and its test**

```bash
git rm src/browser-extension/snapshot.ts tests/unit/browser/snapshot.test.ts
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`, `npm test`, `npm run build:extension`
Expected: all pass. Confirm no remaining references to `snapshot`/`buildAriaTree`/`createRefMap`/`resolveRef`/`refMap` in `src/browser-extension/` (grep).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(browser-extension): drop content-script snapshot and ref paths (now CDP); delete snapshot.ts"
```

---

## Task 5: `browser_read` tool — `mode` param

**Files:**
- Modify: `src/main/agent/tools/browser.ts`
- Test: `tests/unit/browser/agent-tools-browser.test.ts`

- [ ] **Step 1: Update the failing test**

In `tests/unit/browser/agent-tools-browser.test.ts`, add after the existing `browser_read passes maxElements through to the bridge` test:

```ts
  it('browser_read forwards mode alongside maxElements', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const read = tools.find(t => t.name === 'browser_read')!
    await read.run({ mode: 'full', maxElements: 0 }, ctx)
    expect(bridge.calls).toEqual([{ name: 'read', params: { mode: 'full', maxElements: 0 } }])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/browser/agent-tools-browser.test.ts`
Expected: FAIL — `mode` not in the read schema (zod strips unknown keys).

- [ ] **Step 3: Update the `browser_read` tool**

Replace the `browser_read` tool in `src/main/agent/tools/browser.ts`:

```ts
    {
      name: 'browser_read',
      description:
        'Return the page as a nested accessibility tree (role + accessible name) with refs, using Chrome\'s ' +
        'accessibility engine (covers shadow DOM and iframes). Use a ref with browser_click/type/select. ' +
        'mode "interactive" (default) refs interactive elements; "full" includes every accessible node. ' +
        'Pass maxElements to raise the node cap (interactive default 200, full default 500; 0 = no limit).',
      schema: z.object({
        selector: z.string().optional().describe('Optional CSS selector; ignored when snapshotting via CDP.'),
        mode: z.enum(['interactive', 'full']).optional().describe('interactive (default) or full snapshot.'),
        maxElements: z.number().int().min(0).max(2000).optional().describe('Max tree nodes; 0 means no limit (default 200 interactive / 500 full).')
      }),
      async run(input): Promise<ToolRunResult> {
        const { selector, mode, maxElements } = input as unknown as { selector?: string; mode?: 'interactive' | 'full'; maxElements?: number }
        const params: Record<string, unknown> = {}
        if (selector != null) params.selector = selector
        if (mode != null) params.mode = mode
        if (maxElements != null) params.maxElements = maxElements
        return fmt(await bridge.execute('read', params))
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/browser/agent-tools-browser.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/browser.ts tests/unit/browser/agent-tools-browser.test.ts
git commit -m "feat(agent): browser_read mode param (interactive/full) for deep snapshot"
```

---

## Task 6: Docs + full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-meow-browser-deep-snapshot-design.md`

- [ ] **Step 1: Add one clarification line to the spec's tool table**

In `docs/superpowers/specs/2026-08-10-meow-browser-deep-snapshot-design.md`, §9 `browser_read` bullet, append the selector note so it matches the implemented tool:

`browser_read {selector?, mode?, maxElements?}` → trả tree text + page summary. (`selector` chỉ giữ vì tương thích schema; snapshot thực hiện qua CDP toàn trang.)

- [ ] **Step 2: Run full required checks**

Run: `npm run typecheck`, `npm test`, `npm run build:extension`
Expected: all pass. Report the exact test counts.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-meow-browser-deep-snapshot-design.md
git commit -m "docs: clarify deep snapshot read tool surface"
```

---

## Manual verification (after implementation; needs real Chrome)

1. Reload the extension in `chrome://extensions` (already at 0.2.0).
2. Page with shadow DOM / web components → `browser_read` shows inner elements; `browser_click {ref}` on one works.
3. Page with a cross-origin `<iframe>` → `browser_read` shows iframe content; clicking a ref inside the iframe works.
4. **Infobar check**: the "debugging" infobar appears once when the agent starts working, then stays — no flicker during repeated `browser_screenshot`/`browser_click`.
5. `browser_read {mode:'full', maxElements: 0}` on a large page → full tree (expect large token usage).
6. `browser_read` on `chrome://extensions` → clear "page not CDP-accessible" error.
