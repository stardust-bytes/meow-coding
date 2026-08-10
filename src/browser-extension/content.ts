import type { BrowserCommandName } from '../../src/shared/browser-types'

declare global {
  interface XMLHttpRequest {
    __meowMethod?: string
    __meowUrl?: string
  }
}

type CmdResult = { ok: boolean; data?: unknown; error?: string }

interface CmdRequest {
  kind: 'cmd'
  name: BrowserCommandName
  params: Record<string, unknown>
}

function query(selector: string): Element | null {
  return document.querySelector(selector)
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function waitForEl(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise(resolve => {
    const el = query(selector)
    if (el) { resolve(el); return }
    const start = Date.now()
    const iv = setInterval(() => {
      const found = query(selector)
      if (found || Date.now() - start >= timeoutMs) {
        clearInterval(iv)
        resolve(found)
      }
    }, 200)
  })
}

function scrollIntoView(el: Element): void {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
}

async function execute(name: BrowserCommandName, params: Record<string, unknown>): Promise<CmdResult> {
  switch (name) {
    case 'navigate': {
      location.href = String(params.url)
      return { ok: true }
    }
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
    case 'select': {
      if (params.selector == null) return { ok: false, error: 'select requires selector' }
      const el = query(String(params.selector))
      if (!el) return { ok: false, error: `selector not found: ${params.selector}` }
      const select = el as HTMLSelectElement
      select.value = String(params.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true }
    }
    case 'scroll': {
      if (params.selector != null) {
        const el = query(String(params.selector))
        if (!el) return { ok: false, error: `selector not found: ${params.selector}` }
        scrollIntoView(el)
        return { ok: true }
      }
      const dir = String(params.direction ?? 'down')
      if (dir === 'top') window.scrollTo(0, 0)
      else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight)
      else if (dir === 'up') window.scrollBy(0, -window.innerHeight * 0.8)
      else window.scrollBy(0, window.innerHeight * 0.8)
      return { ok: true }
    }
    case 'waitFor': {
      const el = await waitForEl(String(params.selector), Number(params.timeoutMs ?? 10000))
      if (!el) return { ok: false, error: `timeout waiting for selector: ${params.selector}` }
      return { ok: true, data: { selector: params.selector } }
    }
    case 'watchStart': {
      startObserver()
      return { ok: true }
    }
    case 'watchStop': {
      stopObserver()
      return { ok: true }
    }
    default:
      return { ok: false, error: `unsupported command: ${name}` }
  }
}

// ---- console intercept ----
function sendEvent(name: string, data: unknown): void {
  chrome.runtime.sendMessage({ kind: 'event', name, data }).catch(() => {})
}

const consoleLevels = ['log', 'info', 'warn', 'error', 'debug'] as const
const originalConsole: Record<string, (...args: unknown[]) => void> = {}
for (const level of consoleLevels) {
  originalConsole[level] = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    originalConsole[level](...args)
    sendEvent('console', { level, text: args.map(String).join(' ').slice(0, 4000), ts: Date.now() })
  }
}

window.addEventListener('error', (e) => {
  sendEvent('console', { level: 'error', text: String(e.message), ts: Date.now() })
})
window.addEventListener('unhandledrejection', (e) => {
  sendEvent('console', { level: 'error', text: `Unhandled rejection: ${String(e.reason)}`, ts: Date.now() })
})

// ---- network intercept ----
const originalFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined) ?? 'GET')
  const start = performance.now()
  return originalFetch(input, init).then(res => {
    sendEvent('network', { method, url, status: res.status, ms: Math.round(performance.now() - start), ts: Date.now() })
    return res
  }).catch(err => {
    sendEvent('network', { method, url, status: 0, ms: Math.round(performance.now() - start), error: String(err), ts: Date.now() })
    throw err
  })
}

const origOpen = XMLHttpRequest.prototype.open
const origSend = XMLHttpRequest.prototype.send
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true,
  username?: string | null, password?: string | null
): void {
  this.__meowMethod = method
  this.__meowUrl = String(url)
  origOpen.call(this, method, url, async, username, password)
}
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
  const start = performance.now()
  this.addEventListener('loadend', () => {
    sendEvent('network', { method: this.__meowMethod, url: this.__meowUrl, status: this.status, ms: Math.round(performance.now() - start), ts: Date.now() })
  })
  origSend.call(this, body)
}

// ---- MutationObserver (watch) ----
let observer: MutationObserver | null = null
let watchTimer: ReturnType<typeof setTimeout> | null = null

function startObserver(): void {
  if (observer) return
  observer = new MutationObserver(() => {
    if (watchTimer) return
    watchTimer = setTimeout(() => {
      watchTimer = null
      sendEvent('domChanged', { url: location.href, ts: Date.now() })
    }, 300)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
}

function stopObserver(): void {
  observer?.disconnect()
  observer = null
  if (watchTimer) {
    clearTimeout(watchTimer)
    watchTimer = null
  }
}

window.addEventListener('load', () => {
  sendEvent('tabUpdated', { status: 'complete', url: location.href, ts: Date.now() })
})

chrome.runtime.onMessage.addListener((msg: CmdRequest, _sender, sendResponse) => {
  if (msg?.kind !== 'cmd') return false
  void execute(msg.name, msg.params ?? {}).then(sendResponse)
  return true
})
