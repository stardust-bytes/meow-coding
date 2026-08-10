import type { SnapshotNode } from '../../shared/browser-types'

export function snapshotToText(tree: SnapshotNode[]): string {
  const lines: string[] = []
  const walk = (nodes: SnapshotNode[], depth: number): void => {
    for (const n of nodes) {
      const indent = '  '.repeat(depth)
      const name = n.name ? ` "${n.name}"` : ''
      const ref = n.ref ? ` [${n.ref}]` : ''
      lines.push(`${indent}${n.role}${name}${ref}`)
      if (n.children && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return lines.join('\n')
}

export function countSnapshotNodes(tree: SnapshotNode[]): number {
  let count = 0
  const walk = (nodes: SnapshotNode[]): void => {
    for (const n of nodes) {
      count++
      if (n.children && n.children.length) walk(n.children)
    }
  }
  walk(tree)
  return count
}
