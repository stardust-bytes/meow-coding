import { describe, expect, it } from 'vitest'
import { createJsonStore } from '../../src/main/json-store'
import { TemplateManager } from '../../src/main/template-manager'
import type { Template } from '../../src/shared/types'

const DEFAULTS: Template[] = [
  { id: 'opencode', name: 'opencode', command: 'opencode', args: [] }
]

function makeManager() {
  const items: Template[] = []
  const store = {
    load: () => items,
    save: (next: Template[]) => { items.splice(0, items.length, ...next) }
  }
  return { manager: new TemplateManager(store, DEFAULTS), items }
}

describe('TemplateManager', () => {
  it('lists defaults when nothing saved', () => {
    const { manager } = makeManager()
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })

  it('saves a new template and assigns an id', () => {
    const { manager, items } = makeManager()
    const saved = manager.save({ id: '', name: 'custom', command: 'mycli', args: ['--x'] })
    expect(saved.id).toBeTruthy()
    expect(items).toHaveLength(1)
    expect(manager.list()).toContainEqual(saved)
  })

  it('updates an existing template by id', () => {
    const { manager } = makeManager()
    manager.save({ id: 'opencode', name: 'opencode2', command: 'opencode', args: [] })
    const list = manager.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('opencode2')
  })

  it('does not remove a default template', () => {
    const { manager } = makeManager()
    manager.remove('opencode')
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })

  it('removes a custom template', () => {
    const { manager } = makeManager()
    const saved = manager.save({ id: '', name: 'custom', command: 'x', args: [] })
    manager.remove(saved.id)
    expect(manager.list().map(t => t.id)).toEqual(['opencode'])
  })
})
