import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']

// System-prompt pointer: project rules are attached automatically when the
// model reads/edits a file (see loop.ts), so we don't inline every AGENTS.md
// into every turn.
export const INSTRUCTION_POINTER =
  'Project rules live in AGENTS.md files. When you read or edit a file, relevant AGENTS.md ' +
  'files (walking up from that file to the repo root) are attached automatically. Read @AGENTS.md ' +
  'at the project root if you need the top-level rules before working.'

export interface InstructionFile {
  path: string
  content: string
}

function walkUp(startDir: string, collect: (dir: string) => void): void {
  let dir = path.resolve(startDir)
  const home = homedir()
  while (true) {
    collect(dir)
    const isGitRoot = existsSync(path.join(dir, '.git'))
    if (isGitRoot || dir === home) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

export function loadInstructions(cwd: string, userDataDir?: string): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  walkUp(cwd, dir => {
    for (const f of INSTRUCTION_FILES) add(path.join(dir, f))
  })
  if (userDataDir) {
    for (const f of INSTRUCTION_FILES) add(path.join(userDataDir, f))
  }
  return out
}

// Instruction files near a file the model just read/edited, walking up to the
// repo root — the opencode-style "attach on read" behavior.
export function instructionFilesForFile(filePath: string): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  walkUp(path.dirname(filePath), dir => {
    for (const f of INSTRUCTION_FILES) add(path.join(dir, f))
  })
  return out
}

export function instructionsText(files: InstructionFile[]): string {
  if (files.length === 0) return ''
  return '\n\n' + files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')
}
