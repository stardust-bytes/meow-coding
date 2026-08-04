import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']

export interface InstructionFile {
  path: string
  content: string
}

export function loadInstructions(cwd: string, userDataDir?: string): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  let dir = path.resolve(cwd)
  const home = homedir()
  while (true) {
    for (const f of INSTRUCTION_FILES) add(path.join(dir, f))
    const isGitRoot = existsSync(path.join(dir, '.git'))
    if (isGitRoot || dir === home) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (userDataDir) {
    for (const f of INSTRUCTION_FILES) add(path.join(userDataDir, f))
  }
  return out
}

export function instructionsText(files: InstructionFile[]): string {
  if (files.length === 0) return ''
  return '\n\n' + files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')
}
