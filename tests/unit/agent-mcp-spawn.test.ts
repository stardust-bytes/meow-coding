import { describe, expect, it, vi } from 'vitest'
import { McpManager } from '../../src/main/agent/mcp/manager'

const transportCalls: Array<{ command: string; args?: string[]; cwd?: string; env?: Record<string, string> }> = []

// Stub out StdioClientTransport so we can inspect what McpManager would
// spawn without actually launching a process on the test host.
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(opts: { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }) {
      transportCalls.push({ command: opts.command, args: opts.args, cwd: opts.cwd, env: opts.env })
    }
  }
}))

function reset() {
  transportCalls.length = 0
}

describe('McpManager.makeTransport (Windows shim rule)', () => {
  it('wraps a non-.exe MCP command via cmd.exe on win32', () => {
    reset()
    const mcp = new McpManager({ projectPath: '/proj' })
    ;(mcp as unknown as { makeTransport(c: unknown): unknown }).makeTransport({ command: 'npx', args: ['@playwright/mcp'] })
    expect(transportCalls).toHaveLength(1)
    const call = transportCalls[0]
    if (process.platform === 'win32') {
      expect(call.command).toBe('cmd.exe')
      expect(call.args).toEqual(['/d', '/s', '/c', 'npx @playwright/mcp'])
    } else {
      expect(call.command).toBe('npx')
      expect(call.args).toEqual(['@playwright/mcp'])
    }
    expect(call.cwd).toBe('/proj')
  })

  it('keeps a real .exe MCP command unchanged on win32', () => {
    reset()
    const mcp = new McpManager({ projectPath: '/proj' })
    ;(mcp as unknown as { makeTransport(c: unknown): unknown }).makeTransport({ command: 'C:\\tools\\mcp-server.exe', args: ['-v'] })
    expect(transportCalls).toHaveLength(1)
    expect(transportCalls[0].command).toBe('C:\\tools\\mcp-server.exe')
    expect(transportCalls[0].args).toEqual(['-v'])
    expect(transportCalls[0].cwd).toBe('/proj')
  })
})