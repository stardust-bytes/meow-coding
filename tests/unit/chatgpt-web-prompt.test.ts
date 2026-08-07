// tests/unit/chatgpt-web-prompt.test.ts
import { describe, expect, it } from 'vitest'
import { compileChatGptWebPrompt, CHATGPT_WEB_TOOL_CALL_FENCE } from '../../src/main/chatgpt-web/prompt'
import type { ToolDefinition } from '../../src/main/agent/tools/types'

const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Run a shell command',
  inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  async run() { return { output: '' } }
} as unknown as ToolDefinition

describe('compileChatGptWebPrompt', () => {
  it('includes the system prompt verbatim', () => {
    const prompt = compileChatGptWebPrompt({ system: 'You are meow.', messages: [], tools: [] })
    expect(prompt).toContain('You are meow.')
  })

  it('includes the tool_call fenced-block protocol instructions', () => {
    const prompt = compileChatGptWebPrompt({ system: 'sys', messages: [], tools: [] })
    expect(prompt).toContain('```' + CHATGPT_WEB_TOOL_CALL_FENCE)
    expect(prompt.toLowerCase()).toContain('do not execute')
  })

  it('serializes tool name and description into the prompt', () => {
    const prompt = compileChatGptWebPrompt({ system: 'sys', messages: [], tools: [bashTool] })
    expect(prompt).toContain('"name": "bash"')
    expect(prompt).toContain('Run a shell command')
  })

  it('serializes message history as JSON', () => {
    const prompt = compileChatGptWebPrompt({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }] as never,
      tools: []
    })
    expect(prompt).toContain('"role": "user"')
    expect(prompt).toContain('hello')
  })
})
