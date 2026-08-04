import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_FILE = 32 * 1024

const MENTION_RE = /@([\w./\\-]+)/g

export function expandReferences(cwd: string, text: string): string {
  const mentions: Array<{ token: string; path: string }> = []
  for (const m of text.matchAll(MENTION_RE)) {
    const token = m[1]
    const abs = path.isAbsolute(token) ? token : path.join(cwd, token)
    mentions.push({ token, path: abs })
  }
  if (mentions.length === 0) return text

  const blocks: string[] = []
  for (const { token, path: abs } of mentions) {
    if (!existsSync(abs) || !statSync(abs).isFile()) continue
    let content: string
    try {
      content = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    if (content.length > MAX_FILE) content = content.slice(0, MAX_FILE) + '\n...(truncated)'
    blocks.push(`@${token} (${abs}):\n${content}`)
  }
  if (blocks.length === 0) return text
  return text + '\n\nReferenced files:\n\n' + blocks.join('\n\n')
}
