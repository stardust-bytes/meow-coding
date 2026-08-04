import { describe, expect, it, vi, afterEach } from 'vitest'
import { websearchTool } from '../../src/main/agent/tools/websearch'
import type { ToolContext } from '../../src/main/agent/tools/types'

const ctx: ToolContext = { cwd: '/proj', ask: async () => null }

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TAVILY_API_KEY
})

describe('websearch tool', () => {
  it('returns a formatted result list', async () => {
    process.env.TAVILY_API_KEY = 'tavily-key'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: 'First Result', url: 'https://example.com/1', content: 'Some content here' }
        ]
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await websearchTool.run({ query: 'meow coding' }, ctx)
    expect(r.output).toContain('1. First Result')
    expect(r.output).toContain('https://example.com/1')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.api_key).toBe('tavily-key')
    expect(body.query).toBe('meow coding')
  })

  it('reports a missing API key', async () => {
    const r = await websearchTool.run({ query: 'x' }, ctx)
    expect(r.error).toMatch(/TAVILY_API_KEY/)
  })

  it('reports HTTP errors', async () => {
    process.env.TAVILY_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    const r = await websearchTool.run({ query: 'x' }, ctx)
    expect(r.error).toMatch(/HTTP 429/)
  })
})
