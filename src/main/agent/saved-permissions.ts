import type { JsonStore } from '../json-store'
import { matchPattern } from './permission'

export interface SavedPermission {
  projectPath: string
  tool: string
}

// MCP servers expose one distinct tool per action (mcp__<server>__<action>,
// e.g. mcp__playwright__browser_navigate, mcp__playwright__browser_click).
// Saving each action's exact name would make "Always Allow" re-prompt for
// every new action the agent happens to call — scope the saved decision to
// the whole server instead, matching what the user actually means by it.
function mcpServerScope(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const end = tool.indexOf('__', 5)
  if (end === -1) return null
  return `${tool.slice(0, end + 2)}*`
}

export class SavedPermissions {
  constructor(private store: JsonStore<SavedPermission>) {}

  isAllowed(projectPath: string, tool: string): boolean {
    return this.store.load().some(e => e.projectPath === projectPath && matchPattern(e.tool, tool))
  }

  save(projectPath: string, tool: string): void {
    const scoped = mcpServerScope(tool) ?? tool
    const all = this.store.load().filter(e => !(e.projectPath === projectPath && e.tool === scoped))
    all.push({ projectPath, tool: scoped })
    this.store.save(all)
  }
}
