import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpManager } from '../../src/main/agent/mcp/manager'
import type { ToolContext } from '../../src/main/agent/tools/types'

const ctx: ToolContext = { cwd: '/proj', ask: async () => null }

function makeEchoServer(): Server {
  const server = new Server({ name: 'mock', version: '1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo text back',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
      }
    ]
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments as { text?: string }
    return { content: [{ type: 'text', text: 'echo:' + (args?.text ?? '') }] }
  })
  return server
}

describe('McpManager', () => {
  const servers: Server[] = []
  const managers: McpManager[] = []

  afterEach(async () => {
    for (const m of managers) await m.closeAll()
    managers.length = 0
    for (const s of servers) {
      try { await s.close() } catch { /* ignore */ }
    }
    servers.length = 0
  })

  it('exposes MCP tools as mcp__<server>__<tool> and runs them', async () => {
    const server = makeEchoServer()
    servers.push(server)
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)

    const mcp = new McpManager({ createTransport: () => clientSide })
    managers.push(mcp)
    await mcp.connect({ mock: { command: 'node' } })

    const tools = mcp.getTools()
    expect(tools.has('mcp__mock__echo')).toBe(true)
    const echo = tools.get('mcp__mock__echo')!
    expect(echo.description).toContain('Echo text')
    const r = await echo.run({ text: 'hi' }, ctx)
    expect(r.output).toBe('echo:hi')

    const status = mcp.status()
    expect(status).toHaveLength(1)
    expect(status[0].name).toBe('mock')
    expect(status[0].status).toBe('connected')
    expect(status[0].tools).toEqual(['echo'])
  })

  it('declares roots capability and serves the project dir as workspace root', async () => {
    const server = makeEchoServer()
    servers.push(server)
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)

    const projectDir = mkdtempSync(path.join(tmpdir(), 'meow-mcp-root-'))
    try {
      const mcp = new McpManager({ createTransport: () => clientSide })
      managers.push(mcp)
      await mcp.connect({ mock: { command: 'node' } }, projectDir)

      // The client advertises roots, so the server can ask for the workspace.
      const roots = await server.listRoots()
      expect(roots.roots).toHaveLength(1)
      expect(roots.roots[0].name).toBe(projectDir)
      expect(roots.roots[0].uri.startsWith('file://')).toBe(true)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('skips servers that fail to connect without throwing', async () => {
    const mcp = new McpManager({ createTransport: () => {
      throw new Error('no transport')
    } })
    managers.push(mcp)
    await mcp.connect({ broken: { command: 'node' } })
    expect(mcp.getTools().size).toBe(0)
    const status = mcp.status()
    expect(status).toHaveLength(1)
    expect(status[0].name).toBe('broken')
    expect(status[0].status).toBe('error')
    expect(status[0].error).toMatch(/no transport/)
  })

  it('reports tool errors via result.error', async () => {
    const server = new Server({ name: 'mock', version: '1' }, { capabilities: { tools: {} } })
    servers.push(server)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'fail', description: 'fails', inputSchema: { type: 'object', properties: {} } }]
    }))
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      isError: true,
      content: [{ type: 'text', text: 'boom' }]
    }))
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)

    const mcp = new McpManager({ createTransport: () => clientSide })
    managers.push(mcp)
    await mcp.connect({ mock: { command: 'node' } })
    const r = await mcp.getTools().get('mcp__mock__fail')!.run({}, ctx)
    expect(r.error).toBe('boom')
  })
})
