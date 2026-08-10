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
      description: 'Navigate the working tab (the tab the agent is currently operating on) to a URL (http/https).',
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
        'Returns a tabId you can pass to browser_switch_tab / browser_close_tab.',
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
        y: z.number().optional().describe('Viewport y coordinate (requires x).')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, x, y } = input as unknown as { ref?: string; selector?: string; x?: number; y?: number }
        if (ref != null) return fmt(await bridge.execute('click', { ref }))
        return fmt(await bridge.execute('click', selector ? { selector } : { x, y }))
      }
    },
    {
      name: 'browser_type',
      description: 'Type text into an input/textarea/select by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the input element.'),
        text: z.string().describe('Text to type.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, text } = input as unknown as { ref?: string; selector?: string; text: string }
        return fmt(await bridge.execute('type', ref != null ? { ref, text } : { selector, text }))
      }
    },
    {
      name: 'browser_select',
      description: 'Select an option value in a <select> by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the select element.'),
        value: z.string().describe('Option value to select.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { ref, selector, value } = input as unknown as { ref?: string; selector?: string; value: string }
        return fmt(await bridge.execute('select', ref != null ? { ref, value } : { selector, value }))
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page (direction: up/down/top/bottom) or bring a selector into view.',
      schema: z.object({
        direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
        selector: z.string().optional().describe('CSS selector to scroll into view.')
      }),
      async run(input): Promise<ToolRunResult> {
        const { direction, selector } = input as unknown as { direction?: 'up' | 'down' | 'top' | 'bottom'; selector?: string }
        return fmt(await bridge.execute('scroll', selector ? { selector } : { direction: direction ?? 'down' }))
      }
    },
    {
      name: 'browser_read',
      description:
        'Return the page as a nested accessibility tree (role + accessible name per node) with refs ' +
        'on interactive elements, plus the visible text. Use a ref with browser_click/type/select. ' +
        'Pass maxElements to raise the tree node cap (default 200, use 0 for no limit). ' +
        'Re-read after navigating or if the page changed.',
      schema: z.object({
        selector: z.string().optional().describe('Optional CSS selector; defaults to the whole page.'),
        maxElements: z.number().int().min(0).max(500).optional().describe('Max tree nodes; 0 means no limit (default 200).')
      }),
      async run(input): Promise<ToolRunResult> {
        const { selector, maxElements } = input as unknown as { selector?: string; maxElements?: number }
        return fmt(await bridge.execute('read', selector ? { selector, maxElements } : { maxElements }))
      }
    },
    {
      name: 'browser_screenshot',
      description: 'Capture a full-page PNG of the working tab (background tabs supported) without switching tabs or focusing Chrome.',
      schema: z.object({}),
      async run(): Promise<ToolRunResult> {
        return fmt(await bridge.execute('screenshot'))
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
        timeoutMs: z.number().int().positive().max(60_000).optional()
      }),
      async run(input): Promise<ToolRunResult> {
        const { selector, timeoutMs } = input as unknown as { selector: string; timeoutMs?: number }
        return fmt(await bridge.execute('waitFor', { selector, timeoutMs: timeoutMs ?? 10_000 }, (timeoutMs ?? 10_000) + 5000))
      }
    }
  ]
}
