import type { SnapshotNode, BrowserReadMode } from '../../src/shared/browser-types'

export interface AxNodeLike {
  nodeId: string
  ignored?: boolean
  role?: { value?: string } | string
  name?: { value?: string } | string
  backendDOMNodeId?: number
  childIds?: string[]
}

export interface AxSnapshotRef {
  ref: string
  backendDOMNodeId: number
}

export interface AxToTreeOptions {
  mode?: BrowserReadMode
  maxNodes?: number
  textMaxChars?: number
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio',
  'switch', 'combobox', 'listbox', 'option', 'tab', 'textbox', 'searchbox', 'spinbutton',
  'slider', 'treeitem', 'gridcell', 'scrollbar'
])
const SKIPPED_ROLES = new Set(['generic', 'none', 'presentation'])
const TEXT_ROLES = new Set(['text', 'statictext', 'inlinetextbox'])

function axString(v: { value?: string } | string | undefined): string {
  return typeof v === 'string' ? v : (v?.value ?? '')
}

export function axTreeToSnapshot(
  nodes: AxNodeLike[],
  opts: AxToTreeOptions = {}
): { tree: SnapshotNode[]; refs: AxSnapshotRef[] } {
  const mode = opts.mode ?? 'interactive'
  const defaultMax = mode === 'full' ? 500 : 200
  const rawMax = opts.maxNodes ?? defaultMax
  const maxNodes = rawMax > 0 ? rawMax : Infinity
  const textMaxChars = opts.textMaxChars ?? 120

  const byId = new Map(nodes.map(n => [n.nodeId, n]))
  const isChild = new Set<string>()
  for (const n of nodes) for (const c of n.childIds ?? []) isChild.add(c)
  const root = nodes.find(n => !isChild.has(n.nodeId)) ?? nodes[0]
  if (!root) return { tree: [], refs: [] }

  const refTargets = new Map<SnapshotNode, number>()
  let count = 0

  const visit = (n: AxNodeLike): SnapshotNode | null => {
    if (maxNodes > 0 && count >= maxNodes) return null
    if (n.ignored) return null
    const role = axString(n.role).toLowerCase()
    const name = axString(n.name).trim().replace(/\s+/g, ' ').slice(0, textMaxChars)
    const textLike = TEXT_ROLES.has(role)
    const interactive = INTERACTIVE_ROLES.has(role)
    const skipRole = SKIPPED_ROLES.has(role)

    if (textLike) {
      if (!name) return null
      count++
      return { role: 'text', name }
    }

    count++

    const children: SnapshotNode[] = []
    for (const childId of n.childIds ?? []) {
      if (maxNodes > 0 && count >= maxNodes) break
      const c = byId.get(childId)
      if (!c) continue
      const cn = visit(c)
      if (cn) children.push(cn)
    }

    const kids = name ? children.filter(c => !(c.role === 'text' && c.name === name)) : children

    if (mode === 'interactive' && !interactive && skipRole && !name && kids.length === 0) {
      count--
      return null
    }

    const node: SnapshotNode = {
      role,
      ...(name ? { name } : {}),
      ...(kids.length || !name ? { children: kids } : {})
    }
    const wantRef = interactive || (mode === 'full' && n.backendDOMNodeId != null)
    if (wantRef && n.backendDOMNodeId != null) {
      refTargets.set(node, n.backendDOMNodeId)
    }
    return node
  }

  const rootNode = visit(root)

  const refs: AxSnapshotRef[] = []
  if (rootNode) {
    let refCounter = 0
    const queue: SnapshotNode[] = [rootNode]
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i]
      const backend = refTargets.get(node)
      if (backend != null) {
        refCounter++
        node.ref = `r${refCounter}`
        refs.push({ ref: node.ref, backendDOMNodeId: backend })
      }
      if (node.children) queue.push(...node.children)
    }
  }

  return { tree: rootNode ? [rootNode] : [], refs }
}
