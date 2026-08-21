import { describe, expect, it } from 'vitest'
import { isPathLike } from '../../src/renderer/src/components/chat/markdownPaths'

describe('isPathLike', () => {
  it('matches dot-relative and slash-relative paths', () => {
    expect(isPathLike('./src/app.ts')).toBe(true)
    expect(isPathLike('../lib/util.ts')).toBe(true)
  })

  it('matches absolute and drive-letter paths', () => {
    expect(isPathLike('/usr/local/bin/node')).toBe(true)
    expect(isPathLike('C:\\dev\\project\\main.ts')).toBe(true)
  })

  it('matches bare paths ending in a file extension', () => {
    expect(isPathLike('src/main/index.ts')).toBe(true)
    expect(isPathLike('webpack.config.js')).toBe(true)
    expect(isPathLike('Dockerfile')).toBe(false) // extension-less bare word is prose
  })

  it('rejects prose and commands with whitespace even when they end in .ext', () => {
    expect(isPathLike('run the build.ts')).toBe(false)
    expect(isPathLike('const x = require(\'./a.ts\')')).toBe(false)
  })

  it('rejects multi-line code blocks that merely end with a file extension', () => {
    const block = `const a = 1\nconst b = 2\nexport default a.ts`
    expect(isPathLike(block)).toBe(false)
  })

  it('rejects empty and whitespace-only text', () => {
    expect(isPathLike('')).toBe(false)
    expect(isPathLike('   ')).toBe(false)
  })
})
