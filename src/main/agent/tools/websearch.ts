import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface TavilyResult {
  title: string
  url: string
  content: string
}

export const websearchTool: ToolDefinition = {
  name: 'websearch',
  description:
    'Search the web using the Tavily API and return a concise list of results. ' +
    'Requires a TAVILY_API_KEY environment variable.',
  schema: z.object({
    query: z.string().describe('The search query.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { query } = input as unknown as { query: string }
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return {
        error: 'websearch: chưa cấu hình biến môi trường TAVILY_API_KEY. Thêm key để dùng websearch.'
      }
    }
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5, include_answer: false })
      })
      if (!res.ok) return { error: `websearch: HTTP ${res.status}` }
      const data = await res.json() as { results?: TavilyResult[] }
      const results = (data.results ?? []).map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content.slice(0, 300)}`
      ).join('\n\n')
      return { output: results || '(no results)' }
    } catch (err) {
      return { error: `websearch: ${String(err)}` }
    }
  }
}
