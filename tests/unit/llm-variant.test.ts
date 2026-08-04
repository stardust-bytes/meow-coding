import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLlm } from '../../src/main/agent/llm'
import type { ModelVariant } from '../../src/shared/types'

function fakeCompletion() {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

describe('llm variant (openai-compatible)', () => {
  it('sends reasoning_effort for medium/high/max', async () => {
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', c => { data += c })
      req.on('end', () => {
        bodies.push(data)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(fakeCompletion())
      })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const variants: ModelVariant[] = ['medium', 'high', 'max']
    for (const variant of variants) {
      const stream = llm.stream({ model: 'deepseek-chat', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], variant })
      for await (const part of stream) {
        if (part.kind === 'error') throw new Error(part.error)
      }
    }
    server.close()
    expect(bodies).toHaveLength(3)
    const efforts = bodies.map(b => (JSON.parse(b) as { reasoning_effort?: string }).reasoning_effort)
    expect(efforts).toEqual(['medium', 'high', 'xhigh'])
  })

  it('sends nothing when variant is absent', async () => {
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', c => { data += c })
      req.on('end', () => {
        bodies.push(data)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(fakeCompletion())
      })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const stream = llm.stream({ model: 'deepseek-chat', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [] })
    for await (const part of stream) {
      if (part.kind === 'error') throw new Error(part.error)
    }
    server.close()
    expect((JSON.parse(bodies[0]) as { reasoning_effort?: string }).reasoning_effort).toBeUndefined()
  })
})
