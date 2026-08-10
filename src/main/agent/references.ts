import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// Instruction files are attached in full (like opencode); other referenced
// files are capped at 50KB with a hint to page the rest via the read tool.
const MAX_FILE = 50 * 1024
const INSTRUCTION_BASENAMES = new Set(['AGENTS.md', 'CLAUDE.md'])

// Group 1 = whole token (quoted or not), group 2 = quoted content, group 3 =
// bare token. Quoted form supports paths with spaces: @"my file.txt".
const MENTION_RE = /@("([^"]+)"|([\w./\\-]+))/g

// Resolves a mention against cwd, walking up parent directories (to the git
// root or home) when the file is not at cwd — so @AGENTS.md still expands even
// when the agent runs from a subdirectory, matching loadInstructions.
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

export function expandReferences(cwd: string, text: string): string {
  const mentions: Array<{ token: string; abs: string | null }> = []
  for (const m of text.matchAll(MENTION_RE)) {
    const token = m[2] ?? m[3]
    mentions.push({ token, abs: resolveFile(cwd, token) })
  }
  if (mentions.length === 0) return text

  const blocks: string[] = []
  for (const { token, abs } of mentions) {
    if (!abs) continue
    let content: string
    try {
      content = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    // Instruction files attach in full; other files cap at MAX_FILE with a
    // hint to read the rest via the read tool (opencode-style paging).
    if (!INSTRUCTION_BASENAMES.has(path.basename(abs)) && content.length > MAX_FILE) {
      content = content.slice(0, MAX_FILE) +
        '\n...(truncated at 50KB — use the read tool with offset to read the rest)'
    }
    blocks.push(`@${token} (${abs}):\n${content}`)
  }
  if (blocks.length === 0) return text
  return text + '\n\nReferenced files:\n\n' + blocks.join('\n\n')
}
