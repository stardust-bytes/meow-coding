import type { BridgeToExtension, ExtensionToBridge } from '../../src/shared/browser-types'

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

async function sendToTab(tabId: number, name: string, params: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { kind: 'cmd', name, params })
    return res as { ok: boolean; data?: unknown; error?: string }
  } catch (err) {
    return { ok: false, error: `content script unavailable: ${String(err)}` }
  }
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
        send({ ok: true, data: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })) })
        return
      }
      case 'openTab': {
        const tab = await chrome.tabs.create({ url: String(params.url ?? '') })
        send({ ok: true, data: { id: tab?.id, url: tab?.url } })
        return
      }
      case 'switchTab': {
        const tab = await chrome.tabs.update(Number(params.tabId), { active: true })
        send({ ok: true, data: { id: tab?.id, url: tab?.url } })
        return
      }
      case 'closeTab': {
        await chrome.tabs.remove(Number(params.tabId))
        send({ ok: true })
        return
      }
      case 'reload': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await activeTabId())
        if (tabId == null) { send({ ok: false, error: 'no active tab' }); return }
        await chrome.tabs.reload(tabId)
        send({ ok: true })
        return
      }
      case 'navigate': {
        const tabId = params.tabId != null ? Number(params.tabId) : (await activeTabId())
        if (tabId == null) { send({ ok: false, error: 'no active tab' }); return }
        await chrome.tabs.update(tabId, { url: String(params.url) })
        send({ ok: true, data: { url: params.url } })
        return
      }
      case 'screenshot': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        const winId = tab?.windowId
        if (winId == null) { send({ ok: false, error: 'no active window' }); return }
        const dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' })
        send({ ok: true, data: { base64: dataUrl.split(',')[1] ?? '' } })
        return
      }
      default: {
        const tabId = params.tabId != null ? Number(params.tabId) : (await activeTabId())
        if (tabId == null) { send({ ok: false, error: 'no active tab' }); return }
        const res = await sendToTab(tabId, name, params)
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

connect()
