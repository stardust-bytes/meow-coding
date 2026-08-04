import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createOpenAICompatibleLlm } from '../../src/main/agent/llm'
import { SessionRunner } from '../../src/main/agent/loop'
import type { LoopDeps } from '../../src/main/agent/loop'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import type { ChatEvent, ChatMessage, ToolCallData } from '../../src/shared/types'
import type { TranscriptItem } from '../../src/main/agent/message'

function startOverlapServer(chunks: string[]): Promise<{ port: number; close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      let i = 0
      const timer = setInterval(() => {
        if (i < chunks.length) {
          const c = chunks[i++]
          res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(c)}},"index":0}]}\n\n`)
        } else {
          res.write('data: [DONE]\n\n')
          clearInterval(timer)
          res.end()
        }
      }, 5)
    })
    server.listen(0, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => server.close()
      })
    })
  })
}

describe('agent stream overlap handling', () => {
  const servers: Array<{ close: () => void }> = []
  afterEach(() => {
    for (const s of servers) s.close()
    servers.length = 0
  })

  it('dedupes overlapping stream deltas so the rendered text stays clean', async () => {
    const intended = 'Tất nhiên!! Bạn muốn tôi giúp phần nào??'
    const overlappingChunks = [
      'Tất', 'ất nhi', 'nhiên!!', 'ên!! ', '!! Bạn', 'n muốn', 'ốn tôi', 'ôi giúp', 'úp phần', 'ần nào', 'o??'
    ]
    const srv = await startOverlapServer(overlappingChunks)
    servers.push(srv)

    const items: TranscriptItem[] = []
    const events: ChatEvent[] = []
    const deps: LoopDeps = {
      agentId: 'a1',
      model: 'm',
      system: 'sys',
      cwd: '/proj',
      llm: createOpenAICompatibleLlm({ apiKey: 'x', baseUrl: `http://127.0.0.1:${srv.port}/v1` }),
      tools: createDefaultTools(),
      decidePermission: () => 'allow',
      ask: async () => null,
      onEvent: (e) => events.push(e),
      getItems: () => items,
      appendMessage: (m: ChatMessage) => items.push({ kind: 'message', message: m }),
      appendTool: (t: ToolCallData) => items.push({ kind: 'tool', tool: t })
    }
    const runner = new SessionRunner(deps)
    items.push({
      kind: 'message',
      message: { id: 'u1', role: 'user', text: 'chào', createdAt: Date.now() }
    })
    await runner.run()

    const streamed = events
      .filter((e): e is Extract<ChatEvent, { type: 'text-delta' }> => e.type === 'text-delta')
      .map(e => e.delta)
      .join('')
    expect(streamed).toBe(intended)

    const assistant = items
      .filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message')
      .map(i => i.message)
      .find(m => m.role === 'assistant')
    expect(assistant?.text).toBe(intended)
  }, 15000)
})
