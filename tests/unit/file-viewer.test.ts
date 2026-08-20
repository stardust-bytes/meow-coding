import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, shell: {}, Notification: class {} }))

import {
  extOf, isTextPath, looksLikeBinaryContent, TEXT_EXTENSIONS
} from '../../src/main/file-viewer'

describe('extOf', () => {
  it('extracts lowercase extension', () => {
    expect(extOf('README.MD')).toBe('md')
    expect(extOf('/a/b/app.ts')).toBe('ts')
    expect(extOf('C:\\proj\\notes.txt')).toBe('txt')
  })
  it('returns empty for no extension or dotfiles', () => {
    expect(extOf('Dockerfile')).toBe('')
    expect(extOf('.gitignore')).toBe('')
    expect(extOf('a.')).toBe('')
  })
})

describe('isTextPath', () => {
  it('returns true for known text extensions', () => {
    for (const p of ['README.md', '/a/b/app.ts', 'pkg.json', 'notes.txt', 'main.py', 'styles.css', 'C:\\x\\y.yaml']) {
      expect(isTextPath(p)).toBe(true)
    }
  })
  it('opens code files in the viewer: tsx, java, vue and more', () => {
    for (const p of ['a.tsx', 'b.java', 'c.vue', 'd.svelte', 'e.kt', 'f.swift', 'g.cs', 'h.dart', 'i.rb', 'j.ex', 'k.clj']) {
      expect(isTextPath(p)).toBe(true)
    }
  })
  it('treats extension-less files as text', () => {
    expect(isTextPath('Dockerfile')).toBe(true)
    expect(isTextPath('Makefile')).toBe(true)
  })
  it('returns false for binary extensions', () => {
    for (const p of ['a.pdf', 'a.docx', 'a.png', 'a.zip', 'a.exe', 'a.mp4']) {
      expect(isTextPath(p)).toBe(false)
    }
  })
  it('returns null (unknown) for unlisted extensions', () => {
    expect(isTextPath('a.xyz')).toBeNull()
    expect(isTextPath('b.unknown')).toBeNull()
  })
})

describe('looksLikeBinaryContent', () => {
  it('detects NUL bytes', () => {
    expect(looksLikeBinaryContent('a\u0000b')).toBe(true)
  })
  it('returns false for plain text', () => {
    expect(looksLikeBinaryContent('hello world\nline 2')).toBe(false)
  })
})

describe('TEXT_EXTENSIONS', () => {
  it('includes core text extensions', () => {
    for (const e of ['md', 'txt', 'ts', 'tsx', 'json', 'py', 'yaml', 'yml', 'css', 'html']) {
      expect(TEXT_EXTENSIONS).toContain(e)
    }
  })
  it('includes code file extensions across languages', () => {
    for (const e of [
      'tsx', 'jsx', 'vue', 'svelte', 'astro', 'scss', 'less',
      'java', 'kt', 'swift', 'dart', 'cs', 'go', 'rs', 'zig', 'nim',
      'rb', 'php', 'lua', 'pl', 'hs', 'ex', 'clj', 'erl', 'fs',
      'mts', 'cts', 'graphql', 'gql', 'proto', 'prisma', 'tf', 'hcl'
    ]) {
      expect(TEXT_EXTENSIONS).toContain(e)
    }
  })
})
