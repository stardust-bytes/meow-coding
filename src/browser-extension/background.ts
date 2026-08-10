import type { BridgeToExtension, ExtensionToBridge } from '../../src/shared/browser-types'
import { createDebugSession } from './debug-session'
import { axTreeToSnapshot } from './ax-snapshot'
import type { AxNodeLike } from './ax-snapshot'

const DEFAULT_PORT = 3927
const STORAGE_KEY = 'meowBridge'

interface StoredState {
  port?: number
  code?: string
  connected?: boolean
}

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
let paired = false
let pendingCode: string | null = null

const GROUP_TITLE = 'Meow'
const GROUP_COLOR = 'blue' as chrome.tabGroups.ColorEnum

let workingTabId: number | null = null
let groupLock: Promise<unknown> = Promise.resolve()

const debugSession = createDebugSession(chrome.debugger)

let snapshotRefs = new Map<string, number>()

function persistWorkingTab(id: number | null): void {
  workingTabId = id
  void chrome.storage.session.set({ workingTabId: id }).catch(() => {})
}

function saveState(patch: Partial<StoredState>): void {
  void chrome.storage.local.get(STORAGE_KEY).then((res: Record<string, StoredState | undefined>) => {
    const cur = res[STORAGE_KEY] ?? {}
    void chrome.storage.local.set({ [STORAGE_KEY]: { ...cur, ...patch } }).catch(() => {})
  }).catch(() => {})
}

async function loadState(): Promise<StoredState> {
  const res = await chrome.storage.local.get(STORAGE_KEY)
  return (res[STORAGE_KEY] as StoredState | undefined) ?? {}
}

function broadcastStatus(): void {
  void chrome.runtime.sendMessage({ kind: 'status', paired, connected: ws?.readyState === WebSocket.OPEN }).catch(() => {})
}

async function detectPort(): Promise<number> {
  const state = await loadState()
  if (state.port) return state.port
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/api/status`)
    if (res.ok) {
      const body = await res.json() as { port?: number }
      if (typeof body.port === 'number') return body.port
    }
  } catch {
    // Meow chưa chạy hoặc port khác — dùng default
  }
  return DEFAULT_PORT
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  void chrome.storage.session.get('workingTabId').then(async (res) => {
    const id = (res as { workingTabId?: number | null }).workingTabId
    if (id == null) return
    try {
      const t = await chrome.tabs.get(id)
      workingTabId = t.id ?? null
    } catch {
      workingTabId = null
    }
  })
  void (async () => {
    const port = await detectPort()
    const state = await loadState()
    let socket: WebSocket
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`)
    } catch {
      scheduleReconnect()
      return
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      socket.close()
      return
    }
    ws = socket
    const code = pendingCode ?? state.code ?? null
    socket.onopen = () => {
      if (ws !== socket) return
      paired = false
      broadcastStatus()
      if (code) socket.send(JSON.stringify({ type: 'pair', code } satisfies ExtensionToBridge))
    }
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as BridgeToExtension
      if (msg.type === 'pair_result') {
        if (ws !== socket) return
        paired = msg.ok
        if (msg.ok) {
          pendingCode = null
          saveState({ connected: true })
          reconnectDelay = 1000
        } else {
          saveState({ connected: false })
          void debugSession.close()
        }
        broadcastStatus()
        return
      }
      if (msg.type === 'cmd') {
        void handleCommand(msg)
        return
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      paired = false
      saveState({ connected: false })
      broadcastStatus()
      ws = null
      void debugSession.close()
      scheduleReconnect()
    }
    socket.onerror = () => {
      socket.close()
    }
  })()
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 30000)
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

async function lastFocusedWindowId(): Promise<number | undefined> {
  const wins = await chrome.windows.getAll({})
  if (wins.length === 0) return undefined
  const focused = wins.find(w => w.focused)
  if (focused?.id != null) return focused.id
  try {
    const last = await chrome.windows.getLastFocused()
    return last?.id
  } catch {
    return wins[0]?.id
  }
}

async function meowGroupId(): Promise<number | undefined> {
  const groups = await chrome.tabGroups.query({})
  return groups.find(g => g.title === GROUP_TITLE)?.id
}

function addToMeowGroup(tabId: number): Promise<{ groupId?: number; groupTitle?: string }> {
  const run = groupLock.then(async () => {
    const existing = await meowGroupId()
    const groupId = await chrome.tabs.group({ tabIds: [tabId], ...(existing != null ? { groupId: existing } : {}) })
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR })
    return { groupId, groupTitle: GROUP_TITLE }
  })
  groupLock = run.catch(() => {})
  return run
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

async function sendToTab(tabId: number, name: string, params: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { kind: 'cmd', name, params })
    return res as { ok: boolean; data?: unknown; error?: string }
  } catch (err) {
    return { ok: false, error: `content script unavailable: ${String(err)}` }
  }
}

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

async function handleCommand(msg: Extract<BridgeToExtension, { type: 'cmd' }>): Promise<void> {
  const { id, name, params = {} } = msg
  const send = (result: { ok: boolean; data?: unknown; error?: string }): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const out: ExtensionToBridge = result.ok
      ? { type: 'result', id, ok: true, data: result.data }
      : { type: 'result', id, ok: false, error: result.error ?? 'command failed' }
    ws.send(JSON.stringify(out))
  }

  try {
    switch (name) {
      case 'listTabs': {
        const tabs = await chrome.tabs.query({})
        const groupIds = [...new Set(tabs.map(t => t.groupId).filter((id): id is number => id != null && id >= 0))]
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
            groupTitle: t.groupId != null && t.groupId >= 0 ? groupTitles.get(t.groupId) : undefined
          }))
        })
        return
      }
      case 'openTab': {
        const url = String(params.url ?? '')
        const windowId = await lastFocusedWindowId()
        const tab = windowId != null
          ? await chrome.tabs.create({ url, windowId, active: false })
          : await chrome.tabs.create({ url })
        persistWorkingTab(tab.id ?? null)
        let group: { groupId?: number; groupTitle?: string } = {}
        if (tab.id != null) {
          try {
            group = await addToMeowGroup(tab.id)
          } catch {
            /* group creation failed; the tab itself is still open */
          }
        }
        send({ ok: true, data: { id: tab.id, tabId: tab.id, url: tab.url, ...group } })
        return
      }
      case 'switchTab': {
        const tabId = Number(params.tabId)
        const tab = await chrome.tabs.update(tabId, { active: true })
        persistWorkingTab(tab?.id ?? null)
        send({ ok: true, data: { id: tab?.id, url: tab?.url } })
        return
      }
      case 'closeTab': {
        await chrome.tabs.remove(Number(params.tabId))
        send({ ok: true })
        return
      }
      case 'reload': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        await chrome.tabs.reload(tabId)
        persistWorkingTab(tabId)
        send({ ok: true })
        return
      }
      case 'navigate': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        await chrome.tabs.update(tabId, { url: String(params.url) })
        persistWorkingTab(tabId)
        send({ ok: true, data: { url: params.url } })
        return
      }
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
      default: {
        const tabId = params.tabId != null ? Number(params.tabId) : (await defaultTabId())
        if (tabId == null) { send({ ok: false, error: 'no target tab' }); return }
        const res = await sendToTab(tabId, name, params)
        if (res.ok) persistWorkingTab(tabId)
        send(res)
      }
    }
  } catch (err) {
    send({ ok: false, error: String(err) })
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'pair') {
    pendingCode = String(msg.code)
    saveState({ code: pendingCode })
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pair', code: pendingCode } satisfies ExtensionToBridge))
    } else {
      connect()
    }
    sendResponse({ ok: true })
    return false
  }
  if (msg?.kind === 'status') {
    sendResponse({ paired, connected: ws?.readyState === WebSocket.OPEN })
    return false
  }
  if (msg?.kind === 'event') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'event', name: msg.name, data: msg.data } satisfies ExtensionToBridge))
    }
    sendResponse({ ok: true })
    return false
  }
  return false
})

chrome.runtime.onInstalled.addListener(() => {
  void loadState().then(s => {
    if (s.code) connect()
  })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (debugSession.attachedTabId() === tabId) void debugSession.close()
})

connect()
