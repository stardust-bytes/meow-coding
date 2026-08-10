import { describe, expect, it } from 'vitest'
import { axTreeToSnapshot } from '../../../src/browser-extension/ax-snapshot'
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
})
