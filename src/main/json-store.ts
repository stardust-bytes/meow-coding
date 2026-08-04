import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface JsonStore<T> {
  load(): T[]
  save(items: T[]): void
}

export function createJsonStore<T>(filePath: string): JsonStore<T> {
  return {
    load(): T[] {
      if (!existsSync(filePath)) return []
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
        return Array.isArray(parsed) ? (parsed as T[]) : []
      } catch {
        return []
      }
    },
    save(items: T[]): void {
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(items, null, 2))
    }
  }
}
