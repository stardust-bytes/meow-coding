import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { BrowserCommandName, BrowserCommandResult, BrowserStatusInfo } from '../../../shared/browser-types'

export interface BrowserBridgeLike {
  getStatus(): BrowserStatusInfo
  execute(name: BrowserCommandName, params?: Record<string, unknown>, timeoutMs?: number): Promise<BrowserCommandResult>
  waitForPaired(timeoutMs: number): Promise<boolean>
  getConsoleLogs(limit?: number): unknown[]
  getNetworkLogs(limit?: number): unknown[]
}

export interface BrowserLauncherLike {
  openChrome(): Promise<void>
  openExtensionFolder(): Promise<void>
  showInstallGuide(): Promise<void>
}

export function createBrowserTools(
  bridge: BrowserBridgeLike,
  launcher: BrowserLauncherLike
): ToolDefinition[] {
  const fmt = (r: BrowserCommandResult): ToolRunResult =>
    r.ok ? { output: JSON.stringify(r.data ?? {}, null, 2) } : { error: r.error }

  return [
    {
      name: 'browser_start',
      description:
        'Ensure the Chrome bridge is connected. If not paired, opens Chrome, shows install steps, ' +
        'and waits for the user to pair the extension. Returns the bridge status.',
      schema: z.object({}),
      async run(): Promise<ToolRunResult> {
        const status = bridge.getStatus()
        if (status.paired) {
          return { output: `browser paired (port ${status.port})` }
        }
        await launcher.openChrome()
        await launcher.showInstallGuide()
        const paired = await bridge.waitForPaired(60_000)
        if (!paired) return { error: 'browser not paired after 60s — check the pairing code in the extension popup' }
        return { output: `browser paired (port ${bridge.getStatus().port})` }
      }
    },
    {
      name: 'browser_navigate',
      description:
        'Open a URL in a new background tab of an existing Chrome window, grouped under "Meow". ' +
        'Never navigates or hijacks an existing tab. Returns a tabId for other browser_* tools.',
      schema: z.object({
        url: z.string().describe('The http(s) URL to open.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { url } = input as unknown as { url: string }
        if (!/^https?:\/\//i.test(url)) return { error: `browser_navigate: invalid url: ${url}` }
        return fmt(await bridge.execute('navigate', { url }))
      }
    },
    {
      name: 'browser_open_tab',
      description:
        'Open a URL in a new background tab of an existing Chrome window, grouped under "Meow". ' +
        'Never opens a new Chrome window unless none are open, and does not focus Chrome. ' +
        'Returns a tabId for other browser_* tools.',
      schema: z.object({
        url: z.string().describe('The http(s) URL to open.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { url } = input as unknown as { url: string }
        if (!/^https?:\/\//i.test(url)) return { error: `browser_open_tab: invalid url: ${url}` }
        return fmt(await bridge.execute('openTab', { url }))
      }
    },
    {
      name: 'browser_click',
      description: 'Click an element by snapshot ref (preferred), CSS selector, or viewport coordinates (x, y).',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read, e.g. r4.'),
        selector: z.string().optional().describe('CSS selector of the element to click.'),
        x: z.number().optional().describe('Viewport x coordinate (requires y).'),
        y: z.number().optional().describe('Viewport y coordinate (requires x).'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, x, y, tabId } = input as unknown as { ref?: string; selector?: string; x?: number; y?: number; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        if (ref != null) return fmt(await bridge.execute('click', { ...base, ref }))
        return fmt(await bridge.execute('click', selector ? { ...base, selector } : { ...base, x, y }))
      }
    },
    {
      name: 'browser_type',
      description: 'Type text into an input/textarea/select by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the input element.'),
        text: z.string().describe('Text to type.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, text, tabId } = input as unknown as { ref?: string; selector?: string; text: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await bridge.execute('type', { ...base, ...(ref != null ? { ref, text } : { selector, text }) }))
      }
    },
    {
      name: 'browser_select',
      description: 'Select an option value in a <select> by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the select element.'),
        value: z.string().describe('Option value to select.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, value, tabId } = input as unknown as { ref?: string; selector?: string; value: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await bridge.execute('select', { ...base, ...(ref != null ? { ref, value } : { selector, value }) }))
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page (direction: up/down/top/bottom) or bring a selector into view.',
      schema: z.object({
        direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
        selector: z.string().optional().describe('CSS selector to scroll into view.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { direction, selector, tabId } = input as unknown as { direction?: 'up' | 'down' | 'top' | 'bottom'; selector?: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await bridge.execute('scroll', selector ? { ...base, selector } : { ...base, direction: direction ?? 'down' }))
      }
    },
    {
      name: 'browser_read',
      description:
        'Snapshot the active/visible tab (or tabId) into a page-structure file, Playwright-MCP style: ' +
        'every element on one indented line as `role "name" [ref]` (anchors <a> are role "link", plus ' +
        'button, textbox, checkbox, ... — the snapshot is complete, never truncated). ' +
        'Returns the file path, node count and a preview. Read the file (with the file read tool, in ' +
        'chunks if large) to see every element, then click/type/select using the [ref] shown.',
      schema: z.object({
        mode: z.enum(['interactive', 'full']).optional().describe('interactive (default) refs interactive elements; full refs every element.'),
        tabId: z.number().int().optional().describe('Optional tab id to snapshot; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { mode, tabId } = input as unknown as { mode?: 'interactive' | 'full'; tabId?: number }
        const params: Record<string, unknown> = {}
        if (mode != null) params.mode = mode
        if (tabId != null) params.tabId = tabId
        return fmt(await bridge.execute('read', params))
      }
    },
    {
      name: 'browser_list_tabs',
      description: 'List open tabs with id, title, url, active, window and tab-group info.',
      schema: z.object({}),
      async run(): Promise<ToolRunResult> {
        return fmt(await bridge.execute('listTabs'))
      }
    },
    {
      name: 'browser_switch_tab',
      description: 'Activate a tab by its id (from browser_list_tabs) without focusing the Chrome window.',
      schema: z.object({
        tabId: z.number().describe('Tab id to activate.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { tabId } = input as unknown as { tabId: number }
        return fmt(await bridge.execute('switchTab', { tabId }))
      }
    },
    {
      name: 'browser_close_tab',
      description: 'Close a tab by its id (from browser_list_tabs).',
      schema: z.object({
        tabId: z.number().describe('Tab id to close.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { tabId } = input as unknown as { tabId: number }
        return fmt(await bridge.execute('closeTab', { tabId }))
      }
    },
    {
      name: 'browser_console',
      description: 'Return recent browser console logs (errors, warnings, page messages).',
      schema: z.object({
        limit: z.number().int().positive().max(200).optional()
      }),
      async run(input): Promise<ToolRunResult> {
        const { limit } = input as unknown as { limit?: number }
        return { output: JSON.stringify(bridge.getConsoleLogs(limit), null, 2) }
      }
    },
    {
      name: 'browser_network',
      description: 'Return recent network requests observed on the page (method, url, status).',
      schema: z.object({
        limit: z.number().int().positive().max(200).optional()
      }),
      async run(input): Promise<ToolRunResult> {
        const { limit } = input as unknown as { limit?: number }
        return { output: JSON.stringify(bridge.getNetworkLogs(limit), null, 2) }
      }
    },
    {
      name: 'browser_wait_for',
      description: 'Wait until a CSS selector exists on the page (polling), up to timeoutMs.',
      schema: z.object({
        selector: z.string().describe('CSS selector to wait for.'),
        timeoutMs: z.number().int().positive().max(60_000).optional(),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { selector, timeoutMs, tabId } = input as unknown as { selector: string; timeoutMs?: number; tabId?: number }
        const params: Record<string, unknown> = { selector, timeoutMs: timeoutMs ?? 10_000 }
        if (tabId != null) params.tabId = tabId
        return fmt(await bridge.execute('waitFor', params, (timeoutMs ?? 10_000) + 5000))
      }
    }
  ]
}
