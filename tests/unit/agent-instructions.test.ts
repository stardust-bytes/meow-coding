import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { instructionsText, loadInstructions } from '../../src/main/agent/instructions'

let root: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meow-inst-'))
  cwd = path.join(root, 'repo', 'src')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('loadInstructions', () => {
  it('collects AGENTS.md from cwd up to the git root', () => {
    execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'repo') })
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo rules')
    writeFileSync(path.join(cwd, 'AGENTS.md'), '# Src rules')
    writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Claude rules')
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outer rules (should be excluded)')
    const files = loadInstructions(cwd)
    const names = files.map(f => path.relative(root, f.path))
    expect(names).toEqual(expect.arrayContaining([
      path.join('repo', 'src', 'AGENTS.md'),
      path.join('repo', 'src', 'CLAUDE.md'),
      path.join('repo', 'AGENTS.md')
    ]))
    expect(names).not.toContain(path.join('AGENTS.md'))
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

  it('includes a user-data instruction file last', () => {
    writeFileSync(path.join(root, 'repo', 'AGENTS.md'), '# Repo')
    const user = path.join(root, 'user')
    mkdirSync(user, { recursive: true })
    writeFileSync(path.join(user, 'AGENTS.md'), '# Global')
    const files = loadInstructions(cwd, user)
    expect(files[files.length - 1].content).toBe('# Global')
  })

  it('formats instruction text', () => {
    expect(instructionsText([])).toBe('')
    const text = instructionsText([{ path: '/x/AGENTS.md', content: 'rules' }])
    expect(text).toContain('Instructions from: /x/AGENTS.md')
    expect(text).toContain('rules')
  })
})
