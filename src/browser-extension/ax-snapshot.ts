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

export interface AxFrameBundle {
  frameId: string
  ownerBackendNodeId?: number
  nodes: AxNodeLike[]
}

// Merge per-frame AX node lists (CDP getFullAXTree is per document) into one flat
// list: namespace nodeIds per frame (they collide across frames), then graft each
// child frame's root under the parent's "Iframe" AX node (matched by the iframe
// element's backendDOMNodeId reported by DOM.getFrameOwner).
export function mergeFrameAxTrees(frames: AxFrameBundle[]): AxNodeLike[] {
  if (frames.length === 0) return []

  const ns = (frameId: string, nodeId: string): string => `${frameId}::${nodeId}`
  const merged: AxNodeLike[] = []
  const byBackend = new Map<number, AxNodeLike>()
  const frameRoot = new Map<string, string>()

  for (const f of frames) {
    const isChild = new Set<string>()
    for (const n of f.nodes) for (const c of n.childIds ?? []) isChild.add(c)
    const root = f.nodes.find(n => !isChild.has(n.nodeId))
    if (root) frameRoot.set(f.frameId, ns(f.frameId, root.nodeId))
    for (const n of f.nodes) {
      const node: AxNodeLike = {
        ...n,
        nodeId: ns(f.frameId, n.nodeId),
        childIds: (n.childIds ?? []).map(c => ns(f.frameId, c))
      }
      merged.push(node)
      if (node.backendDOMNodeId != null) byBackend.set(node.backendDOMNodeId, node)
    }
  }

  for (const f of frames) {
    if (f.ownerBackendNodeId == null) continue
    const childRoot = frameRoot.get(f.frameId)
    if (!childRoot) continue
    const owner = byBackend.get(f.ownerBackendNodeId)
    if (!owner) continue
    owner.childIds = [childRoot]
  }

  return merged
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

  const visit = (n: AxNodeLike): SnapshotNode[] => {
    if (maxNodes > 0 && count >= maxNodes) return []
    if (n.ignored) {
      const promoted: SnapshotNode[] = []
      for (const childId of n.childIds ?? []) {
        if (maxNodes > 0 && count >= maxNodes) break
        const c = byId.get(childId)
        if (!c) continue
        promoted.push(...visit(c))
      }
      return promoted
    }
    const role = axString(n.role).toLowerCase()
    const name = axString(n.name).trim().replace(/\s+/g, ' ').slice(0, textMaxChars)
    const textLike = TEXT_ROLES.has(role)
    const interactive = INTERACTIVE_ROLES.has(role)
    const skipRole = SKIPPED_ROLES.has(role)

    if (textLike) {
      if (!name) return []
      count++
      return [{ role: 'text', name }]
    }

    count++

    const children: SnapshotNode[] = []
    for (const childId of n.childIds ?? []) {
      if (maxNodes > 0 && count >= maxNodes) break
      const c = byId.get(childId)
      if (!c) continue
      children.push(...visit(c))
    }

    const kids = name ? children.filter(c => !(c.role === 'text' && c.name === name)) : children

    if (mode === 'interactive' && !interactive && skipRole && !name && kids.length === 0) {
      count--
      return []
    }

    const node: SnapshotNode = {
      role,
      ...(name ? { name } : {}),
      ...(kids.length || !name ? { children: kids } : {})
    }
    const wantRef = interactive || (mode === 'full' && n.backendDOMNodeId != null && !SKIPPED_ROLES.has(role) && role !== 'rootwebarea')
    if (wantRef && n.backendDOMNodeId != null) {
      refTargets.set(node, n.backendDOMNodeId)
    }
    return [node]
  }

  const rootList = visit(root)
  const rootNode = rootList[0] ?? null

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
