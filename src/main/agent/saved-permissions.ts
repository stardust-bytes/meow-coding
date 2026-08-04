import type { JsonStore } from '../json-store'

export interface SavedPermission {
  projectPath: string
  tool: string
}

export class SavedPermissions {
  constructor(private store: JsonStore<SavedPermission>) {}

  isAllowed(projectPath: string, tool: string): boolean {
    return this.store.load().some(e => e.projectPath === projectPath && e.tool === tool)
  }

  save(projectPath: string, tool: string): void {
    const all = this.store.load().filter(e => !(e.projectPath === projectPath && e.tool === tool))
    all.push({ projectPath, tool })
    this.store.save(all)
  }
}
