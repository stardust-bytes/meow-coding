import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLlm } from '../../src/main/agent/llm'
import type { LlmStreamOptions } from '../../src/main/agent/llm'

function openaiCompletion() {
  return JSON.stringify({
    id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'x',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

function googleCompletion() {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }],
    modelVersion: 'gemini-2.5-pro',
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
  })
}

function captureServer(completionBody: string) {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => {
      bodies.push(data)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(completionBody)
    })
  })
  return { server, bodies }
}

function opts(partial: Partial<LlmStreamOptions>): LlmStreamOptions {
  return { model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], ...partial }
}

describe('llm variantOptions merging', () => {
  it('openai-compatible: merges variantOptions into providerOptions', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    for (const v of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const stream = llm.stream(opts({ variantOptions: { openaiCompatible: { reasoningEffort: v } } }))
      for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    }
    server.close()
    const efforts = bodies.map(b => (JSON.parse(b) as { reasoning_effort?: string }).reasoning_effort)
    expect(efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('google: merges thinkingConfig under google key', async () => {
    const { server, bodies } = captureServer(googleCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('google', 'sk-test', `http://127.0.0.1:${port}/v1beta`)
    const stream = llm.stream(opts({
      model: 'gemini-2.5-pro',
      variantOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } } }
    }))
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    const body = JSON.parse(bodies[0]) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean } }
    }
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('high')
    expect(body.generationConfig?.thinkingConfig?.includeThoughts).toBe(true)
  })

  it('anthropic: merges thinking.budgetTokens under anthropic key', async () => {
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', c => { data += c })
      req.on('end', () => {
        bodies.push(data)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-4-5","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n')
        res.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n')
        res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
        res.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n')
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
        res.end()
      })
    })
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('anthropic', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const s1 = llm.stream(opts({
      model: 'claude-opus-4-5',
      variantOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 16384 } } }
    }))
    for await (const part of s1) { if (part.kind === 'error') throw new Error(part.error) }
    const parsed1 = JSON.parse(bodies[0]) as { thinking?: { budget_tokens?: number; type?: string } }
    expect(parsed1.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })
    server.close()
  })

  it('sends nothing when variantOptions is absent', async () => {
    const { server, bodies } = captureServer(openaiCompletion())
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const llm = createLlm('deepseek', 'sk-test', `http://127.0.0.1:${port}/v1`)
    const stream = llm.stream(opts({}))
    for await (const part of stream) { if (part.kind === 'error') throw new Error(part.error) }
    server.close()
    expect((JSON.parse(bodies[0]) as { reasoning_effort?: string }).reasoning_effort).toBeUndefined()
  })
})
