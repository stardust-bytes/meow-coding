import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const PROJECT_FILES = ['AGENTS.md', 'CLAUDE.md']

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

// First existing global instruction file under the home dir, mirroring
// opencode's ~/.config/opencode/AGENTS.md + ~/.claude/CLAUDE.md. The homeDir
// parameter exists for tests; production always uses homedir().
export function globalInstructionFiles(homeDir: string = homedir()): InstructionFile[] {
  const candidates = [
    path.join(homeDir, '.config', 'meow', 'AGENTS.md'),
    path.join(homeDir, '.claude', 'CLAUDE.md')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return [{ path: p, content: readFileSync(p, 'utf-8') }]
  }
  return []
}

export function loadInstructions(cwd: string): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  for (const f of globalInstructionFiles()) add(f.path)

  // Single-type priority: if any AGENTS.md exists along the walk-up path,
  // collect only AGENTS.md files; otherwise fall back to CLAUDE.md (opencode).
  const dirs: string[] = []
  walkUp(cwd, dir => dirs.push(dir))
  const hasAgents = dirs.some(dir => existsSync(path.join(dir, 'AGENTS.md')))
  const basename = hasAgents ? 'AGENTS.md' : 'CLAUDE.md'
  for (const dir of dirs) add(path.join(dir, basename))
  return out
}

// Instruction files near a file the model just read, walking up to the repo
// root. At each dir the first existing of AGENTS.md/CLAUDE.md wins (opencode
// `find`); `skip` excludes already-attached paths (cross-message dedupe).
export function instructionFilesForFile(filePath: string, skip: ReadonlySet<string> = new Set()): InstructionFile[] {
  const out: InstructionFile[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p) || skip.has(p)) return
    seen.add(p)
    if (existsSync(p)) out.push({ path: p, content: readFileSync(p, 'utf-8') })
  }

  walkUp(path.dirname(filePath), dir => {
    for (const f of PROJECT_FILES) {
      if (existsSync(path.join(dir, f))) {
        add(path.join(dir, f))
        break
      }
    }
  })
  return out
}

export function instructionsText(files: InstructionFile[]): string {
  if (files.length === 0) return ''
  return '\n\n' + files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')
}
