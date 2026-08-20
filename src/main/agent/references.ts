import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// @file mentions pass through to the agent unchanged — the agent reads the
// file itself via its read tool. We only resolve mentions to absolute paths
// and list them as a hint so the agent knows what to open (no content
// inlining into the chat message).
const MENTION_RE = /@("([^"]+)"|([\w./\\-]+))/g

// Resolves a mention against cwd, walking up parent directories (to the git
// root or home) when the file is not at cwd — so @AGENTS.md still resolves
// even when the agent runs from a subdirectory.
function resolveFile(cwd: string, token: string): string | null {
  if (path.isAbsolute(token)) {
    return existsSync(token) && statSync(token).isFile() ? token : null
  }
  let dir = path.resolve(cwd)
  const home = homedir()
  while (true) {
    const candidate = path.join(dir, token)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    const isGitRoot = existsSync(path.join(dir, '.git'))
    if (isGitRoot || dir === home) return null
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function referenceHints(cwd: string, text: string): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    const token = m[2] ?? m[3]
    const abs = resolveFile(cwd, token)
    if (abs && !seen.has(abs)) {
      seen.add(abs)
      lines.push(`- @${token} → ${abs}`)
    }
  }
  if (lines.length === 0) return text
  return text + '\n\nRead these referenced files with the read tool:\n' + lines.join('\n')
}
