import { existsSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type { ToolContext, ToolDefinition } from './tools/types'

export interface UserToolModule {
  name?: string
  description?: string
  schema?: Record<string, unknown>
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<{ output?: string; error?: string }>
}

export async function loadUserTools(dirs: string[]): Promise<ToolDefinition[]> {
  const out: ToolDefinition[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      if (!/\.(c?js)$/.test(entry)) continue
      try {
        const loaded = await import(pathToFileURL(path.join(dir, entry)).href) as { default?: UserToolModule }
        const mod = loaded.default
        if (!mod || typeof mod.run !== 'function') continue
        out.push({
          name: mod.name ?? path.basename(entry, path.extname(entry)),
          description: mod.description ?? '',
          schema: mod.schema ?? { type: 'object', properties: {} },
          run: mod.run
        })
      } catch (err) {
        console.error(`[meow] failed to load user tool "${entry}":`, err)
      }
    }
  }
  return out
}
