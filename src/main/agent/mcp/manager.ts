import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition } from '../tools/types'
import type { McpServerConfig } from '../../../shared/types'
import { buildSpawnCommand } from '../../pty-manager'
import type { TruncationStore } from '../truncation'
import { estimateTokens, charsForTokens } from '../token'
import { DEFAULT_MCP_OUTPUT_TOKENS } from '../config'

export type { McpServerConfig }

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
  /** Project dir served to servers as workspace root and used as spawn cwd. */
  projectPath?: string
  /** Persists full MCP output when it exceeds the token cap; the model gets a head/tail preview + file path. */
  truncation?: TruncationStore
  /** Returns the current mcpOutput.maxTokens override (undefined = default). */
  getMcpOutputMaxTokens?: () => number | undefined
}

export class McpManager {
  private connections = new Map<string, McpConnection>()
  private statuses = new Map<string, McpServerStatus>()

  constructor(private deps: McpManagerDeps = {}) {}

  async connect(servers: Record<string, McpServerConfig>, projectPath?: string): Promise<void> {
    if (projectPath !== undefined) this.deps = { ...this.deps, projectPath }
    await this.closeAll()
    this.statuses.clear()
    for (const [name, cfg] of Object.entries(servers)) {
      try {
        const client = new Client(
          { name: 'meow-coding', version: '0.1.0' },
          {
            capabilities: {
              roots: {
                listChanged: false
              }
            }
          }
        )
        // Playwright MCP & co. ask the client for workspace roots and anchor
        // file access/output dir on them — serve the project dir.
        client.setRequestHandler(ListRootsRequestSchema, async () => ({
          roots: this.rootUris()
        }))
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

  private rootUris(): Array<{ uri: string; name?: string }> {
    const projectPath = this.deps.projectPath
    if (!projectPath) return []
    return existsSync(projectPath) ? [{ uri: pathToFileURL(projectPath).toString(), name: projectPath }] : []
  }

  // Direct call by server + tool name, for callers that address a tool without
  // going through the mcp__server__tool registry — hooks, for one. Resolves the
  // connection at call time for the same reason getTools() does.
  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ output?: string; error?: string }> {
    const conn = this.connections.get(serverName)
    if (!conn) return { error: `MCP server "${serverName}" is not connected` }
    try {
      const res = await conn.client.callTool({ name: toolName, arguments: input })
      const content = (res.content ?? []) as Array<{ type: string; text?: string }>
      const text = content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
      if (res.isError) return { error: text || 'mcp tool error' }
      return { output: text || JSON.stringify(content) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  getTools(): Map<string, ToolDefinition> {
    const out = new Map<string, ToolDefinition>()
    for (const conn of this.connections.values()) {
      const serverName = conn.serverName
      for (const tool of conn.tools) {
        const fullName = `mcp__${serverName}__${tool.name}`
        out.set(fullName, {
          name: fullName,
          description: tool.description ?? `MCP tool ${tool.name} from server ${serverName}`,
          schema: tool.inputSchema ?? { type: 'object', properties: {} },
          run: async (input, callCtx) => {
            // Resolve the connection at call time, not snapshot time: every
            // syncTools() → connect() closes all previous clients, so a tool
            // definition captured by an older runner would otherwise call a
            // closed client and fail with "Not connected".
            const current = this.connections.get(serverName)
            if (!current) return { error: `MCP server "${serverName}" is not connected` }
            const res = await current.client.callTool({ name: tool.name, arguments: input })
            const content = (res.content ?? []) as Array<{ type: string; text?: string }>
            const texts = content.filter(c => c.type === 'text').map(c => c.text ?? '')
            const text = texts.join('\n')
            if (res.isError) return { error: text || 'mcp tool error' }
            const full = text || JSON.stringify(content)
            const maxTokens = this.deps.getMcpOutputMaxTokens?.() ?? DEFAULT_MCP_OUTPUT_TOKENS
            if (estimateTokens(full) <= maxTokens) return { output: full }
            // Exceeds the cap: persist the full output and return a head preview + file path.
            if (this.deps.truncation && callCtx?.agentId) {
              const preview = this.deps.truncation.truncate(callCtx.agentId, fullName, full, { maxBytes: charsForTokens(maxTokens) })
              return { output: preview }
            }
            return { output: full.slice(0, charsForTokens(maxTokens)) + '\n[truncated]' }
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
    // Windows shim rule (same as PtyManager): npm-installed CLIs (npx,
    // @playwright/mcp, …) only ship as .cmd shims. cross-spawn resolves
    // them itself, but going through cmd.exe explicitly is more robust
    // (e.g. when PATH in the packaged app lacks the npm dir) and matches
    // how the terminal panes spawn agents.
    const spawn = buildSpawnCommand(cfg.command, cfg.args ?? [])
    return new StdioClientTransport({
      command: spawn.command,
      args: spawn.args,
      env: cfg.env,
      // Spawn the server in the project dir so servers that use process.cwd()
      // as their workspace (Playwright MCP output dir/file guard) operate on
      // the right folder instead of the Electron app dir.
      cwd: this.deps.projectPath
    })
  }
}
