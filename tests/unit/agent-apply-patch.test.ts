import { describe, expect, it } from 'vitest'
import { applyUnifiedPatch, type PatchFileIO } from '../../src/main/agent/apply-patch'

function memIO(files: Record<string, string> = {}) {
  const deleted: string[] = []
  const io: PatchFileIO = {
    readFile: (p) => (p in files ? files[p] : null),
    writeFile: (p, c) => { files[p] = c },
    deleteFile: (p) => { delete files[p]; deleted.push(p) }
  }
  return { io, files, deleted }
}

describe('applyUnifiedPatch', () => {
  it('creates a new file', () => {
    const { io, files } = memIO()
    const patch = [
      '--- /dev/null',
      '+++ b/hello.txt',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2'
    ].join('\n') + '\n'
    const result = applyUnifiedPatch(patch, io)
    expect(result[0]).toEqual({ filePath: 'hello.txt', created: true, changed: true })
    expect(files['hello.txt']).toBe('line1\nline2\n')
  })

  it('edits an existing file and keeps unchanged context', () => {
    const { io, files } = memIO({ 'f.txt': 'a\nb\nc\n' })
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -2,1 +2,1 @@',
      '-b',
      '+bb'
    ].join('\n') + '\n'
    const result = applyUnifiedPatch(patch, io)
    expect(result[0].changed).toBe(true)
    expect(files['f.txt']).toBe('a\nbb\nc\n')
  })

  it('applies multiple hunks in the same file', () => {
    const { io, files } = memIO({ 'm.txt': '1\n2\n3\n4\n' })
    const patch = [
      '--- a/m.txt',
      '+++ b/m.txt',
      '@@ -1,2 +1,2 @@',
      '-1',
      '+one',
      ' 2',
      '@@ -4,1 +4,1 @@',
      '-4',
      '+four'
    ].join('\n') + '\n'
    applyUnifiedPatch(patch, io)
    expect(files['m.txt']).toBe('one\n2\n3\nfour\n')
  })

  it('inserts lines with an old count of zero', () => {
    const { io, files } = memIO({ 'i.txt': 'a\nc\n' })
    const patch = [
      '--- a/i.txt',
      '+++ b/i.txt',
      '@@ -1,0 +2,1 @@',
      '+b'
    ].join('\n') + '\n'
    applyUnifiedPatch(patch, io)
    expect(files['i.txt']).toBe('a\nb\nc\n')
  })

  it('deletes a file when the target is /dev/null', () => {
    const { io, files, deleted } = memIO({ 'gone.txt': 'x\n' })
    const patch = [
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-x'
    ].join('\n') + '\n'
    applyUnifiedPatch(patch, io)
    expect(deleted).toEqual(['gone.txt'])
    expect(files['gone.txt']).toBeUndefined()
  })

  it('throws on a hunk count mismatch', () => {
    const { io } = memIO({ 'f.txt': 'a\nb\nc\n' })
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,2 @@',
      ' a',
      '-b'
    ].join('\n') + '\n'
    expect(() => applyUnifiedPatch(patch, io)).toThrow()
  })

  it('throws when a hunk goes past the end of the file', () => {
    const { io } = memIO({ 'f.txt': 'a\n' })
    const patch = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -5,1 +5,1 @@',
      ' x'
    ].join('\n') + '\n'
    expect(() => applyUnifiedPatch(patch, io)).toThrow()
  })
})
