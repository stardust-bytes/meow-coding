import { randomUUID } from 'node:crypto'
import type { Template } from '../shared/types'
import type { JsonStore } from './json-store'

export class TemplateManager {
  constructor(
    private store: JsonStore<Template>,
    private defaults: Template[]
  ) {}

  list(): Template[] {
    const saved = this.store.load()
    const savedIds = new Set(saved.map(t => t.id))
    return [...this.defaults.filter(d => !savedIds.has(d.id)), ...saved]
  }

  save(template: Template): Template {
    const next = { ...template, id: template.id || randomUUID() }
    this.store.save(this.store.load().filter(t => t.id !== next.id).concat(next))
    return next
  }

  remove(id: string): void {
    if (this.defaults.some(d => d.id === id)) return
    this.store.save(this.store.load().filter(t => t.id !== id))
  }
}
