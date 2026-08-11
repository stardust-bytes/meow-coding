import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { instructionsText, loadInstructions, instructionFilesForFile, globalInstructionFiles } from '../../src/main/agent/instructions'

let root: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meow-inst-'))
  cwd = path.join(root, 'repo', 'src')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('loadInstructions', () => {
  it('prefers AGENTS.md over CLAUDE.md along the walk-up path', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Claude ignored')
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outer rules (should be excluded)')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'src', 'AGENTS.md'))
    expect(names).toContain(path.join('repo', 'AGENTS.md'))
    expect(names).not.toContain(path.join('repo', 'src', 'CLAUDE.md'))
    expect(names).not.toContain(path.join('AGENTS.md'))
  })

  it('collects CLAUDE.md only when no AGENTS.md exists anywhere on the path', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'CLAUDE.md'), '# Repo claude')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Src claude')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'src', 'CLAUDE.md'))
    expect(names).toContain(path.join('repo', 'CLAUDE.md'))
    expect(names).not.toContain(path.join('repo', 'src', 'AGENTS.md'))
  })

  it('stops at the git root when the repo has .git', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo')
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outside repo')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toContain(path.join('repo', 'AGENTS.md'))
    expect(names).not.toContain(path.join('AGENTS.md'))
  })

  it('formats instruction text', () => {
    expect(instructionsText([])).toBe('')
    const text = instructionsText([{ path: '/x/AGENTS.md', content: 'rules' }])
    expect(text).toContain('Instructions from: /x/AGENTS.md')
    expect(text).toContain('rules')
  })
})

describe('globalInstructionFiles', () => {
  it('returns the meow global file when present', () => {
    const home = path.join(root, 'home')
    mkdirSync(path.join(home, '.config', 'meow'), { recursive: true })
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    writeFileSync(path.join(home, '.config', 'meow', 'AGENTS.md'), '# Global meow')
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Global claude')
    const files = globalInstructionFiles(home)
    expect(files).toHaveLength(1)
    expect(files[0].content).toBe('# Global meow')
    expect(files[0].path).toBe(path.join(home, '.config', 'meow', 'AGENTS.md'))
  })

  it('falls back to ~/.claude/CLAUDE.md when no meow AGENTS.md exists', () => {
    const home = path.join(root, 'home')
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# Claude global')
    const files = globalInstructionFiles(home)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe(path.join(home, '.claude', 'CLAUDE.md'))
  })

  it('returns empty when no global instruction file exists', () => {
    const home = path.join(root, 'home')
    mkdirSync(home, { recursive: true })
    expect(globalInstructionFiles(home)).toEqual([])
  })
})

describe('instructionFilesForFile', () => {
  it('attaches the first existing instruction file per dir, walking up', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Claude ignored')
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'))
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toEqual([path.join('repo', 'src', 'AGENTS.md'), path.join('repo', 'AGENTS.md')])
  })

  it('skips paths in the skip set', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    const skip = new Set([path.join(cwd, 'AGENTS.md')])
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'), skip)
    expect(files.map(f => path.basename(f.path))).toEqual(['AGENTS.md'])
    expect(files[0].path).toBe(path.join(root, 'repo', 'AGENTS.md'))
  })

  it('falls back to CLAUDE.md per dir when no AGENTS.md exists in that dir', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Src claude')
    const files = instructionFilesForFile(path.join(cwd, 'a.ts'))
    expect(files.map(f => path.basename(f.path))).toEqual(['CLAUDE.md', 'AGENTS.md'])
  })

  it('does not attach the instruction file being read itself', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    const files = instructionFilesForFile(path.join(cwd, 'AGENTS.md'))
    expect(files.map(f => path.basename(f.path))).toEqual(['AGENTS.md'])
    expect(files[0].path).toBe(path.join(root, 'repo', 'AGENTS.md'))
  })
})
