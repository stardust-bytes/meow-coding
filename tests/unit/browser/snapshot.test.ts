import { describe, expect, it } from 'vitest'
import { buildAriaTree, resolveRef, createRefMap, fallbackRole } from '../../../src/browser-extension/snapshot'

interface FakeNode {
  tagName: string
  nodeType: number
  getAttribute: (name: string) => string | null
  textContent: string | null
  childNodes: FakeNode[]
  hidden?: boolean
  style?: { display?: string; visibility?: string }
  isConnected?: boolean
  getComputedRole?: () => string
  getComputedName?: () => string
  value?: string
}

const TEXT = 3
const ELEMENT = 1

function makeEl(tag: string, attrs: Record<string, string> = {}, children: FakeNode[] = [], opts: Partial<FakeNode> = {}): FakeNode {
  return {
    tagName: tag.toUpperCase(),
    nodeType: ELEMENT,
    getAttribute: (name) => attrs[name] ?? null,
    textContent: opts.textContent ?? null,
    childNodes: children,
    hidden: opts.hidden,
    style: opts.style,
    isConnected: opts.isConnected ?? true,
    ...(opts.getComputedRole ? { getComputedRole: opts.getComputedRole } : {}),
    ...(opts.getComputedName ? { getComputedName: opts.getComputedName } : {}),
    ...(opts.value != null ? { value: opts.value } : {})
  }
}

function makeText(text: string): FakeNode {
  return { tagName: '', nodeType: TEXT, getAttribute: () => null, textContent: text, childNodes: [] }
}

describe('buildAriaTree', () => {
  it('assigns refs to interactive elements and resolves them', () => {
    const body = makeEl('body', {}, [
      makeEl('nav', {}, [
        makeEl('a', {}, [], { textContent: 'Docs' })
      ]),
      makeEl('button', { 'aria-label': 'Chat' }),
      makeEl('input', { type: 'text' })
    ])
    const { tree, refs } = buildAriaTree(body as unknown as Element, {})
    expect(refs.length).toBe(3)
    const names = refs.map(r => r.ref)
    expect(names).toEqual(['r1', 'r2', 'r3'])
    const map = createRefMap(refs)
    expect(resolveRef('r2', map)).toBe(refs[1].el)
    expect(resolveRef('r99', map)).toBeNull()
  })

  it('uses getComputedRole/Name when present, falls back to attributes', () => {
    const btn = makeEl('div', { 'aria-label': 'Send' }, [], {
      getComputedRole: () => 'button',
      getComputedName: () => 'Send'
    })
    const { tree } = buildAriaTree(btn as unknown as Element, {})
    expect(tree[0]).toMatchObject({ role: 'button', name: 'Send', ref: 'r1' })
  })

  it('derives role/name from tag + text fallback for links and buttons', () => {
    const link = makeEl('a', {}, [], { textContent: '  Docs  ' })
    const { tree } = buildAriaTree(link as unknown as Element, {})
    expect(tree[0]).toMatchObject({ role: 'link', name: 'Docs', ref: 'r1' })
  })

  it('includes text children as text nodes', () => {
    const div = makeEl('div', {}, [
      makeText('  Welcome to Acme  '),
      makeEl('button', { 'aria-label': 'Sign up' })
    ])
    const { tree } = buildAriaTree(div as unknown as Element, {})
    const children = tree[0].children!
    expect(children[0]).toEqual({ role: 'text', name: 'Welcome to Acme' })
    expect(children[1]).toMatchObject({ role: 'button', ref: 'r1' })
  })

  it('skips hidden elements and script/style/template', () => {
    const body = makeEl('body', {}, [
      makeEl('div', {}, [], { hidden: true }),
      makeEl('script'),
      makeEl('style'),
      makeEl('button', { 'aria-label': 'Visible' })
    ])
    const { tree, refs } = buildAriaTree(body as unknown as Element, {})
    expect(refs).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
  })

  it('drops generic containers with no children and no name', () => {
    const div = makeEl('div')
    const { tree } = buildAriaTree(div as unknown as Element, {})
    expect(tree).toHaveLength(0)
  })

  it('caps nodes via maxNodes (0 = unlimited)', () => {
    const buttons = Array.from({ length: 300 }, (_, i) => makeEl('button', { 'aria-label': `b${i}` }))
    const body = makeEl('body', {}, buttons)
    const { tree, refs } = buildAriaTree(body as unknown as Element, { maxNodes: 200 })
    expect(refs.length).toBeLessThanOrEqual(200)
    const { tree: unlimited } = buildAriaTree(body as unknown as Element, { maxNodes: 0 })
    expect(unlimited[0].children!.length).toBe(300)
  })

  it('keeps the root and emits no orphan refs when the node cap is reached', () => {
    const buttons = Array.from({ length: 300 }, (_, i) => makeEl('button', { 'aria-label': `b${i}` }))
    const body = makeEl('body', {}, buttons)
    const { tree, refs } = buildAriaTree(body as unknown as Element, { maxNodes: 200 })
    expect(tree).toHaveLength(1)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.length).toBeLessThanOrEqual(200)
    expect(refs.length).toBe(tree[0].children!.length)
  })

  it('counts text nodes toward the node cap', () => {
    const paragraphs = Array.from({ length: 250 }, (_, i) => makeText(`para ${i}`))
    const body = makeEl('body', {}, paragraphs)
    const { tree } = buildAriaTree(body as unknown as Element, { maxNodes: 200 })
    expect(tree[0].children!.length).toBeLessThanOrEqual(200)
    expect(tree[0].children!.length).toBeGreaterThan(0)
  })
})

describe('fallbackRole', () => {
  it('maps native tags to roles', () => {
    expect(fallbackRole(makeEl('button') as unknown as Element)).toBe('button')
    expect(fallbackRole(makeEl('a') as unknown as Element)).toBe('link')
    expect(fallbackRole(makeEl('select') as unknown as Element)).toBe('combobox')
    expect(fallbackRole(makeEl('input', { type: 'checkbox' }) as unknown as Element)).toBe('checkbox')
    expect(fallbackRole(makeEl('input', { type: 'range' }) as unknown as Element)).toBe('slider')
    expect(fallbackRole(makeEl('nav') as unknown as Element)).toBe('navigation')
  })
})
