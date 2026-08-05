import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { LspManager } from '../lsp/manager'

export function createLspTool(lsp: LspManager): ToolDefinition {
  return {
    name: 'lsp',
    description:
      'Query a language server for code intelligence: goToDefinition, findReferences, hover, ' +
      'documentSymbol. Use to understand how code is wired together before editing.',
    schema: z.object({
      operation: z.enum(['goToDefinition', 'findReferences', 'hover', 'documentSymbol'])
        .describe('The LSP operation to run'),
      file_path: z.string().describe('Absolute path or path relative to the project root.')
    }),
    async run(input, ctx): Promise<ToolRunResult> {
      const { operation, file_path } = input as unknown as { operation: string; file_path: string }
      const full = path.isAbsolute(file_path) ? file_path : path.join(ctx.cwd, file_path)
      const result = await lsp.operation(operation, full)
      if (result.kind === 'error') return { error: result.text }
      return { output: result.text }
    }
  }
}
