import { describe, expect, it } from 'vitest'
import { snapshotToText, countSnapshotNodes } from '../../../src/main/browser/snapshot-format'
import type { SnapshotNode } from '../../../src/shared/browser-types'

describe('snapshotToText', () => {
  it('formats a nested tree with names and refs (Playwright-MCP style)', () => {
    const tree: SnapshotNode[] = [{
      role: 'document',
      name: 'Course',
      children: [
        {
          role: 'navigation',
          name: 'Main',
          children: [
            { role: 'link', name: 'Trang chủ', ref: 'r1' },
            { role: 'link', name: 'Tham gia', ref: 'r2' }
          ]
        },
        { role: 'button', name: 'Đăng nhập', ref: 'r3' }
      ]
    }]
    expect(snapshotToText(tree)).toBe(
      'document "Course"\n' +
      '  navigation "Main"\n' +
      '    link "Trang chủ" [r1]\n' +
      '    link "Tham gia" [r2]\n' +
      '  button "Đăng nhập" [r3]'
    )
  })

  it('omits missing name and ref and handles an empty tree', () => {
    expect(snapshotToText([])).toBe('')
    expect(snapshotToText([{ role: 'generic' }])).toBe('generic')
  })

  it('counts every node in the tree', () => {
    const tree: SnapshotNode[] = [{
      role: 'document',
      children: [
        { role: 'link', name: 'A', ref: 'r1' },
        { role: 'button', name: 'B', ref: 'r2', children: [{ role: 'text', name: 'hi' }] }
      ]
    }]
    expect(countSnapshotNodes(tree)).toBe(4)
  })
})
