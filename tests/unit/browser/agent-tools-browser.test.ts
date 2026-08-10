import { describe, expect, it, vi } from 'vitest'
import { createBrowserTools, type BrowserBridgeLike, type BrowserLauncherLike } from '../../../src/main/agent/tools/browser'
import type { ToolContext } from '../../../src/main/agent/tools/types'
import type { BrowserCommandName } from '../../../src/shared/browser-types'

const ctx: ToolContext = { cwd: '/proj', ask: async () => null }

function fakeBridge(overrides: Partial<BrowserBridgeLike> = {}): BrowserBridgeLike & { calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }> } {
  const calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }> = []
  return {
    getStatus: () => ({ status: 'paired', port: 3927, paired: true }),
    execute: async (name, params) => {
      calls.push({ name, params })
      return { ok: true, data: { echoed: name } }
    },
    waitForPaired: async () => true,
    getConsoleLogs: () => [{ level: 'error', text: 'boom' }],
    getNetworkLogs: () => [{ method: 'GET', url: 'http://x' }],
    ...overrides,
    calls
  }
}

function fakeLauncher(overrides: Partial<BrowserLauncherLike> = {}): BrowserLauncherLike {
  return {
    openChrome: async () => {},
    openExtensionFolder: async () => {},
    showInstallGuide: async () => {},
    ...overrides
  }
}

describe('browser tools', () => {
  it('registers all 15 tools with names', () => {
    const tools = createBrowserTools(fakeBridge(), fakeLauncher())
    expect(tools.map(t => t.name)).toEqual([
      'browser_start', 'browser_navigate', 'browser_open_tab', 'browser_click', 'browser_type',
      'browser_select', 'browser_scroll', 'browser_read', 'browser_screenshot', 'browser_list_tabs',
      'browser_switch_tab', 'browser_close_tab', 'browser_console', 'browser_network', 'browser_wait_for'
    ])
  })

  it('browser_navigate validates the url scheme', async () => {
    const tools = createBrowserTools(fakeBridge(), fakeLauncher())
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const bad = await nav.run({ url: 'ftp://x' }, ctx)
    expect(bad.error).toContain('invalid url')
  })

  it('browser_navigate forwards the command to the bridge', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const r = await nav.run({ url: 'https://example.com' }, ctx)
    expect(r.output).toContain('navigate')
    expect(bridge.calls).toEqual([{ name: 'navigate', params: { url: 'https://example.com' } }])
  })

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

  it('browser_type and browser_select forward ref or selector', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const typeTool = tools.find(t => t.name === 'browser_type')!
    const selectTool = tools.find(t => t.name === 'browser_select')!
    await typeTool.run({ ref: 'r2', text: 'hi' }, ctx)
    await typeTool.run({ selector: '#q', text: 'bye' }, ctx)
    await selectTool.run({ ref: 'r3', value: 'b' }, ctx)
    await selectTool.run({ selector: '#s', value: 'a' }, ctx)
    expect(bridge.calls).toEqual([
      { name: 'type', params: { ref: 'r2', text: 'hi' } },
      { name: 'type', params: { selector: '#q', text: 'bye' } },
      { name: 'select', params: { ref: 'r3', value: 'b' } },
      { name: 'select', params: { selector: '#s', value: 'a' } }
    ])
  })

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

  it('browser_start when paired returns immediately without launching', async () => {
    const launcher = fakeLauncher()
    const openChrome = vi.spyOn(launcher, 'openChrome')
    const tools = createBrowserTools(fakeBridge(), launcher)
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(r.output).toContain('paired')
    expect(openChrome).not.toHaveBeenCalled()
  })

  it('browser_start when not paired opens chrome, shows guide and waits', async () => {
    const launcher = fakeLauncher()
    const openChrome = vi.spyOn(launcher, 'openChrome')
    const showGuide = vi.spyOn(launcher, 'showInstallGuide')
    const bridge = fakeBridge({
      getStatus: () => ({ status: 'listening', port: 3927, paired: false }),
      waitForPaired: async () => true
    })
    const tools = createBrowserTools(bridge, launcher)
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(openChrome).toHaveBeenCalled()
    expect(showGuide).toHaveBeenCalled()
    expect(r.output).toContain('paired')
  })

  it('browser_start reports an error when pairing times out', async () => {
    const bridge = fakeBridge({
      getStatus: () => ({ status: 'listening', port: 3927, paired: false }),
      waitForPaired: async () => false
    })
    const tools = createBrowserTools(bridge, fakeLauncher())
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(r.error).toContain('not paired')
  })

  it('browser_console and browser_network read bridge buffers', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const consoleTool = tools.find(t => t.name === 'browser_console')!
    const networkTool = tools.find(t => t.name === 'browser_network')!
    const c = await consoleTool.run({}, ctx)
    const n = await networkTool.run({}, ctx)
    expect(c.output).toContain('boom')
    expect(n.output).toContain('http://x')
  })

  it('browser_read passes maxElements through to the bridge', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const read = tools.find(t => t.name === 'browser_read')!
    await read.run({ maxElements: 0 }, ctx)
    expect(bridge.calls).toEqual([{ name: 'read', params: { maxElements: 0 } }])
    await read.run({ selector: '#app', maxElements: 100 }, ctx)
    expect(bridge.calls[1]).toEqual({ name: 'read', params: { selector: '#app', maxElements: 100 } })
  })

  it('browser_read forwards mode alongside maxElements', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const read = tools.find(t => t.name === 'browser_read')!
    await read.run({ mode: 'full', maxElements: 0 }, ctx)
    expect(bridge.calls).toEqual([{ name: 'read', params: { mode: 'full', maxElements: 0 } }])
  })

  it('browser_wait_for passes through a longer timeout to the bridge', async () => {
    const bridge = fakeBridge()
    const tools = createBrowserTools(bridge, fakeLauncher())
    const wait = tools.find(t => t.name === 'browser_wait_for')!
    await wait.run({ selector: '.loaded', timeoutMs: 5000 }, ctx)
    expect(bridge.calls).toEqual([{ name: 'waitFor', params: { selector: '.loaded', timeoutMs: 5000 } }])
  })

  it('maps an error result to ToolRunResult.error', async () => {
    const bridge = fakeBridge({
      execute: async () => ({ ok: false, error: 'selector not found: #x' })
    })
    const tools = createBrowserTools(bridge, fakeLauncher())
    const read = tools.find(t => t.name === 'browser_read')!
    const r = await read.run({}, ctx)
    expect(r.error).toContain('selector not found')
  })

  it('zod schema rejects invalid input', async () => {
    const tools = createBrowserTools(fakeBridge(), fakeLauncher())
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const out = await nav.schema.safeParse({ url: 123 })
    expect(out.success).toBe(false)
  })
})
