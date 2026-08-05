import type { LspServerSpec } from './client'

export const LSP_SERVERS: Record<string, LspServerSpec> = {
  typescript: {
    language: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']
  },
  eslint: {
    language: 'javascript',
    command: 'vscode-eslint-language-server',
    args: ['--stdio'],
    extensions: ['js', 'jsx', 'ts', 'tsx']
  },
  biome: {
    language: 'javascript',
    command: 'biome',
    args: ['lsp-proxy'],
    extensions: ['js', 'jsx', 'ts', 'tsx', 'json']
  }
}

export function serverFor(ext: string): LspServerSpec | null {
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(ext)) return spec
  }
  return null
}

export function serverByName(name: string): LspServerSpec | null {
  return LSP_SERVERS[name] ?? null
}
