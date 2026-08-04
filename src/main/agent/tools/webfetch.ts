import TurndownService from 'turndown'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

const DEFAULT_MAX_CHARS = 8000

export const webfetchTool: ToolDefinition = {
  name: 'webfetch',
  description: 'Fetch a URL and return its content as markdown. Use for reading web pages and docs.',
  schema: z.object({
    url: z.string().describe('The http(s) URL to fetch.'),
    maxChars: z.number().int().positive().optional().describe('Max characters to return.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { url, maxChars = DEFAULT_MAX_CHARS } = input as unknown as { url: string; maxChars?: number }
    if (!/^https?:\/\//i.test(url)) return { error: `webfetch: invalid url: ${url}` }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'meow-coding/0.1' }
      })
      if (!res.ok) return { error: `webfetch: HTTP ${res.status} for ${url}` }
      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()
      let body = text
      if (contentType.includes('html')) {
        body = new TurndownService({ codeBlockStyle: 'fenced' }).turndown(text)
      }
      const cleaned = body.replace(/\n{3,}/g, '\n\n').trim()
      const out = cleaned.length > maxChars
        ? cleaned.slice(0, maxChars) + '\n...(truncated)'
        : cleaned
      return { output: out || '(empty page)' }
    } catch (err) {
      return { error: `webfetch: ${String(err)}` }
    } finally {
      clearTimeout(timer)
    }
  }
}
