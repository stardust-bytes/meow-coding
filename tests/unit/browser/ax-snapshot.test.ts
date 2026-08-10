import { describe, expect, it } from 'vitest'
import { axTreeToSnapshot, mergeFrameAxTrees } from '../../../src/browser-extension/ax-snapshot'
import type { AxNodeLike } from '../../../src/browser-extension/ax-snapshot'

function axn(
  nodeId: string,
  opts: Partial<AxNodeLike> = {}
): AxNodeLike {
  return {
    nodeId,
    role: opts.role,
    name: opts.name,
    backendDOMNodeId: opts.backendDOMNodeId,
    childIds: opts.childIds,
    ignored: opts.ignored
  }
}

const role = (v: string): { value: string } => ({ value: v })
const name = (v: string): { value: string } => ({ value: v })

describe('axTreeToSnapshot', () => {
  it('builds a tree in childIds order and finds the root', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), backendDOMNodeId: 1, childIds: ['2', '3'] }),
      axn('2', { role: role('navigation'), name: name('Main'), childIds: ['4'] }),
      axn('3', { role: role('button'), name: name('Chat'), backendDOMNodeId: 7 }),
      axn('4', { role: role('link'), name: name('Docs'), backendDOMNodeId: 9 })
    ]
    const { tree, refs } = axTreeToSnapshot(nodes, {})
    expect(tree).toHaveLength(1)
    const root = tree[0]
    expect(root.role).toBe('rootwebarea')
    expect(root.children!.map(c => c.role)).toEqual(['navigation', 'button'])
    expect(root.children![0].children![0]).toMatchObject({ role: 'link', name: 'Docs' })
    expect(refs.map(r => r.ref)).toEqual(['r1', 'r2'])
    expect(refs[1].backendDOMNodeId).toBe(9)
  })

  it('normalizes role/name whether they are {value} objects or plain strings', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: 'button', name: 'Send', backendDOMNodeId: 3 }),
      axn('2', { role: 'rootwebarea' })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    const button = tree[0]
    expect(button.role).toBe('button')
    expect(button.name).toBe('Send')
  })

  it('skips ignored nodes', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2', '3'] }),
      axn('2', { role: role('generic'), ignored: true }),
      axn('3', { role: role('button'), name: name('Go'), backendDOMNodeId: 5 })
    ]
    const { tree, refs } = axTreeToSnapshot(nodes, {})
    expect(tree[0].children).toHaveLength(1)
    expect(refs).toHaveLength(1)
  })

  it('drops empty generic nodes in interactive mode but keeps them in full mode', () => {
    const generic = axn('2', { role: role('generic'), name: name(''), childIds: [] })
    const nodes: AxNodeLike[] = [axn('1', { role: role('rootwebarea'), childIds: ['2'] }), generic]
    const interactive = axTreeToSnapshot(nodes, { mode: 'interactive' })
    expect(interactive.tree[0].children).toHaveLength(0)
    const full = axTreeToSnapshot(nodes, { mode: 'full' })
    expect(full.tree[0].children).toHaveLength(1)
  })

  it('does not duplicate element name as a text child', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('button'), name: name('Chat'), childIds: ['3'] }),
      axn('3', { role: role('statictext'), name: name('Chat') })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    const button = tree[0].children![0]
    expect(button.name).toBe('Chat')
    expect(button.children).toBeUndefined()
  })

  it('renders static text as text nodes', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('paragraph'), childIds: ['3'] }),
      axn('3', { role: role('statictext'), name: name('  Hello  ') })
    ]
    const { tree } = axTreeToSnapshot(nodes, {})
    expect(tree[0].children![0].children![0]).toEqual({ role: 'text', name: 'Hello' })
  })

  it('caps nodes via maxNodes (0 = unlimited) and truncates names', () => {
    const buttons = Array.from({ length: 300 }, (_, i) =>
      axn(`b${i}`, { role: role('button'), name: name(`Button ${i}`), backendDOMNodeId: 1000 + i }))
    const root = axn('1', { role: role('rootwebarea'), childIds: buttons.map(b => b.nodeId) })
    const capped = axTreeToSnapshot([root, ...buttons], { mode: 'full', maxNodes: 200 })
    expect(capped.refs.length).toBeLessThanOrEqual(200)
    const unlimited = axTreeToSnapshot([root, ...buttons], { mode: 'full', maxNodes: 0 })
    expect(unlimited.tree[0].children!.length).toBe(300)
    const truncated = axTreeToSnapshot(
      [axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
        axn('2', { role: role('button'), name: name('x'.repeat(200)), backendDOMNodeId: 5 })],
      { mode: 'interactive', textMaxChars: 10 }
    )
    expect(truncated.tree[0].children![0].name!.length).toBeLessThanOrEqual(10)
  })

  it('returns an empty tree for an empty node list', () => {
    expect(axTreeToSnapshot([])).toEqual({ tree: [], refs: [] })
  })

  it('promotes non-ignored descendants of an ignored ancestor', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('generic'), ignored: true, childIds: ['3'] }),
      axn('3', { role: role('button'), name: name('Visible'), backendDOMNodeId: 6 })
    ]
    const { tree, refs } = axTreeToSnapshot(nodes, {})
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children![0]).toMatchObject({ role: 'button', name: 'Visible', ref: 'r1' })
    expect(refs).toHaveLength(1)
  })

  it('full mode gives refs to non-interactive element nodes too', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), childIds: ['2'] }),
      axn('2', { role: role('navigation'), name: name('Main'), backendDOMNodeId: 4 })
    ]
    const interactive = axTreeToSnapshot(nodes, { mode: 'interactive' })
    expect(interactive.refs).toHaveLength(0)
    const full = axTreeToSnapshot(nodes, { mode: 'full' })
    expect(full.refs).toEqual([{ ref: 'r1', backendDOMNodeId: 4 }])
  })

  it('full mode does not give refs to root or generic containers', () => {
    const nodes: AxNodeLike[] = [
      axn('1', { role: role('rootwebarea'), backendDOMNodeId: 1, childIds: ['2'] }),
      axn('2', { role: role('generic'), name: name(''), backendDOMNodeId: 2 })
    ]
    const full = axTreeToSnapshot(nodes, { mode: 'full' })
    expect(full.refs).toHaveLength(0)
  })
})

describe('mergeFrameAxTrees', () => {
  it('returns an empty list for no frames', () => {
    expect(mergeFrameAxTrees([])).toEqual([])
  })

  it('returns the frame nodes unchanged (single frame, no owner)', () => {
    const frames = [{ frameId: 'root', nodes: [axn('1', { role: role('rootwebarea'), backendDOMNodeId: 1, childIds: ['2'] })] }]
    const merged = mergeFrameAxTrees(frames)
    expect(merged).toHaveLength(1)
    expect(merged[0].nodeId).toBe('root::1')
    expect(merged[0].childIds).toEqual(['root::2'])
  })

  it('grafts a child frame root under the parent Iframe node', () => {
    const frames = [
      {
        frameId: 'root',
        nodes: [
          axn('1', { role: role('rootwebarea'), backendDOMNodeId: 1, childIds: ['2'] }),
          axn('2', { role: role('Iframe'), backendDOMNodeId: 50, childIds: [] })
        ]
      },
      {
        frameId: 'child',
        ownerBackendNodeId: 50,
        nodes: [
          axn('1', { role: role('rootwebarea'), backendDOMNodeId: 2, childIds: ['2'] }),
          axn('2', { role: role('button'), name: name('Inside'), backendDOMNodeId: 51 })
        ]
      }
    ]
    const merged = mergeFrameAxTrees(frames)
    const owner = merged.find(n => n.nodeId === 'root::2')!
    expect(owner.childIds).toEqual(['child::1'])
    const { tree, refs } = axTreeToSnapshot(merged, {})
    const iframe = tree[0].children!.find(c => c.role === 'iframe')!
    expect(iframe.children).toBeDefined()
    expect(iframe.children![0]).toMatchObject({ role: 'rootwebarea' })
    expect(iframe.children![0].children![0]).toMatchObject({ role: 'button', name: 'Inside', ref: 'r1' })
    expect(refs).toEqual([{ ref: 'r1', backendDOMNodeId: 51 }])
  })

  it('keeps sibling frames distinct and namespaced', () => {
    const frames = [
      {
        frameId: 'root',
        nodes: [
          axn('1', { role: role('rootwebarea'), childIds: ['2', '3'] }),
          axn('2', { role: role('generic') }),
          axn('3', { role: role('generic') })
        ]
      },
      { frameId: 'child', ownerBackendNodeId: 50, nodes: [axn('1', { role: role('rootwebarea'), backendDOMNodeId: 2 })] }
    ]
    const merged = mergeFrameAxTrees(frames)
    expect(merged.map(n => n.nodeId).sort()).toEqual(['child::1', 'root::1', 'root::2', 'root::3'])
  })

  it('leaves the Iframe node alone when the owner backend node is not found', () => {
    const frames = [
      {
        frameId: 'root',
        nodes: [axn('1', { role: role('rootwebarea'), childIds: ['2'] }), axn('2', { role: role('Iframe'), backendDOMNodeId: 50 })]
      },
      {
        frameId: 'child',
        ownerBackendNodeId: 999,
        nodes: [axn('1', { role: role('rootwebarea'), backendDOMNodeId: 2 })]
      }
    ]
    const merged = mergeFrameAxTrees(frames)
    expect(merged.find(n => n.nodeId === 'root::2')!.childIds).toEqual([])
  })
})
