import type { SnapshotNode } from '../../src/shared/browser-types'

export const DEFAULT_MAX_NODES = 200
const TEXT_NODE = 3
const ELEMENT_NODE = 1

export interface SnapshotRef {
  ref: string
  el: Element
}

export interface BuildAriaTreeOptions {
  maxNodes?: number
  textMaxChars?: number
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio',
  'switch', 'combobox', 'listbox', 'option', 'tab', 'textbox', 'searchbox', 'spinbutton',
  'slider', 'treeitem', 'gridcell', 'scrollbar'
])
const GENERIC_ROLES = new Set(['generic', 'none', 'presentation'])
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])

interface A11yElementLike {
  getComputedRole?: () => string
  getComputedName?: () => string
}

export function fallbackRole(el: Element): string {
  const role = el.getAttribute('role')
  if (role) return role
  const tag = el.tagName.toLowerCase()
  if (tag === 'a' || tag === 'area') return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'img') return 'img'
  if (tag === 'nav') return 'navigation'
  if (tag === 'form') return 'form'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'input') {
    const type = el.getAttribute('type') ?? (el as HTMLInputElement).type
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'range') return 'slider'
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
    return 'textbox'
  }
  return 'generic'
}

export function fallbackName(el: Element, useText = false): string {
  const attr = (n: string): string => el.getAttribute(n) ?? ''
  const ariaLabel = attr('aria-label')
  if (ariaLabel) return ariaLabel
  const alt = attr('alt')
  if (alt) return alt
  const placeholder = attr('placeholder')
  if (placeholder) return placeholder
  const value = (el as HTMLInputElement).value
  if (value) return value
  const title = attr('title')
  if (title) return title
  if (useText) return (el.textContent ?? '').trim()
  return ''
}

export function buildAriaTree(
  root: Element,
  opts: BuildAriaTreeOptions = {}
): { tree: SnapshotNode[]; refs: SnapshotRef[] } {
  const maxNodes = (opts.maxNodes ?? DEFAULT_MAX_NODES) > 0 ? (opts.maxNodes ?? DEFAULT_MAX_NODES) : Infinity
  const textMaxChars = opts.textMaxChars ?? 80
  const refs: SnapshotRef[] = []
  let count = 0
  let refCounter = 0

  const visit = (el: Element): SnapshotNode | null => {
    if (count >= maxNodes) return null
    if (SKIPPED_TAGS.has(el.tagName)) return null
    if (el.getAttribute('aria-hidden') === 'true') return null
    const style = (el as HTMLElement).style
    if ((el as HTMLElement).hidden || style?.display === 'none' || style?.visibility === 'hidden') return null

    const a11y = el as Element & A11yElementLike
    const role = a11y.getComputedRole?.() ?? fallbackRole(el)
    const isGeneric = GENERIC_ROLES.has(role)
    const interactive =
      INTERACTIVE_ROLES.has(role) ||
      el.tagName === 'INPUT' ||
      el.tagName === 'SELECT' ||
      el.tagName === 'TEXTAREA'
    const useTextName = interactive || role === 'heading' || role === 'link'

    const children: SnapshotNode[] = []
    for (const child of Array.from(el.childNodes)) {
      if (count >= maxNodes) break
      if (child.nodeType === TEXT_NODE) {
        const t = (child.textContent ?? '').trim().replace(/\s+/g, ' ')
        if (t) children.push({ role: 'text', name: t.slice(0, textMaxChars) })
      } else if (child.nodeType === ELEMENT_NODE) {
        const n = visit(child as Element)
        if (n) children.push(n)
      }
    }

    const rawName = a11y.getComputedName?.()
    const name = (rawName ?? fallbackName(el, useTextName)).trim().replace(/\s+/g, ' ').slice(0, textMaxChars)

    if (isGeneric && !interactive && children.length === 0 && !name) return null
    if (count >= maxNodes) return null
    count++
    let ref: string | undefined
    if (interactive) {
      refCounter++
      ref = `r${refCounter}`
      refs.push({ ref, el })
    }
    return {
      role,
      ...(name ? { name } : {}),
      ...(ref ? { ref } : {}),
      ...(children.length ? { children } : {})
    }
  }

  const rootNode = visit(root)
  return { tree: rootNode ? [rootNode] : [], refs }
}

export function createRefMap(refs: SnapshotRef[]): Map<string, Element> {
  return new Map(refs.map(r => [r.ref, r.el]))
}

export function resolveRef(ref: string, map: Map<string, Element>): Element | null {
  const el = map.get(ref)
  if (el && (el as Element & { isConnected?: boolean }).isConnected !== false) return el
  return null
}
