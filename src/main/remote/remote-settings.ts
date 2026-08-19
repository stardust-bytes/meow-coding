import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../json-store'

export interface RemoteSettings {
  enabled: boolean
  relayUrl: string
  deviceId: string
  sessionToken?: string
}

function defaultSettings(): RemoteSettings {
  return { enabled: false, relayUrl: '', deviceId: randomUUID() }
}

export class RemoteSettingsStore {
  constructor(private store: JsonStore<RemoteSettings>) {}

  load(): RemoteSettings {
    const [existing] = this.store.load()
    if (existing) return existing
    const created = defaultSettings()
    this.store.save([created])
    return created
  }

  save(s: RemoteSettings): void {
    this.store.save([s])
  }
}
