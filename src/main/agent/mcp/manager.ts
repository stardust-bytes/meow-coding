import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolDefinition } from '../tools/types'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpConnection {
  serverName: string
  client: Client
  tools: McpToolInfo[]
}

export interface McpServerStatus {
  name: string
  status: 'connected' | 'error'
  error?: string
  tools: string[]
}

export interface McpManagerDeps {
  createTransport?: (cfg: McpServerConfig) => Transport
}

export class McpManager {
  private connections = new Map<string, McpConnection>()
  private statuses = new Map<string, McpServerStatus>()

  constructor(private deps: McpManagerDeps = {}) {}

  async connect(servers: Record<string, McpServerConfig>): Promise<void> {
    await this.closeAll()
    this.statuses.clear()
    for (const [name, cfg] of Object.entries(servers)) {
      try {
        const client = new Client({ name: 'meow-coding', version: '0.1.0' })
        const transport = this.makeTransport(cfg)
        await client.connect(transport)
        const listed = await client.listTools()
        const tools = (listed.tools ?? []).map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as unknown as Record<string, unknown>
        }))
        this.connections.set(name, { serverName: name, client, tools })
        this.statuses.set(name, { name, status: 'connected', tools: tools.map(t => t.name) })
      } catch (err) {
        this.statuses.set(name, { name, status: 'error', error: String(err), tools: [] })
      }
    }
  }

  status(): McpServerStatus[] {
    return [...this.statuses.values()]
  }

  getTools(): Map<string, ToolDefinition> {
    const out = new Map<string, ToolDefinition>()
    for (const conn of this.connections.values()) {
      for (const tool of conn.tools) {
        const fullName = `mcp__${conn.serverName}__${tool.name}`
        out.set(fullName, {
          name: fullName,
          description: tool.description ?? `MCP tool ${tool.name} from server ${conn.serverName}`,
          schema: tool.inputSchema ?? { type: 'object', properties: {} },
          run: async (input) => {
            const res = await conn.client.callTool({ name: tool.name, arguments: input })
            const content = (res.content ?? []) as Array<{ type: string; text?: string }>
            const texts = content.filter(c => c.type === 'text').map(c => c.text ?? '')
            const text = texts.join('\n')
            if (res.isError) return { error: text || 'mcp tool error' }
            return { output: text || JSON.stringify(content) }
          }
        })
      }
    }
    return out
  }

  async closeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      try {
        await conn.client.close()
      } catch {
        /* already closed */
      }
    }
    this.connections.clear()
  }

  private makeTransport(cfg: McpServerConfig): Transport {
    if (this.deps.createTransport) return this.deps.createTransport(cfg)
    if (cfg.url) return new StreamableHTTPClientTransport(new URL(cfg.url))
    if (!cfg.command) throw new Error('MCP server needs either "command" or "url"')
    return new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env })
  }
}
