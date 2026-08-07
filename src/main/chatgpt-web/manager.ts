import { rmSync } from 'node:fs'
import path from 'node:path'
import { ChatGptWebSessionStore } from './session-store'
import { getChatGptWebModelRefs } from './model-catalog'
import type { ChatGptWebStatus, ModelRef } from '../../shared/types'
import type { ChallengeEvent } from '../../shared/ipc'

export interface ChatGptWebManagerDeps {
  login?: (store: ChatGptWebSessionStore, userDataDir: string) => Promise<{ authenticated: boolean; verifiedAt: string }>
  notifyChallenge?: (event: ChallengeEvent) => void
}

export class ChatGptWebManager {
  private readonly store: ChatGptWebSessionStore

  constructor(configDir: string, private readonly deps: ChatGptWebManagerDeps = {}) {
    this.store = new ChatGptWebSessionStore(configDir)
  }

  getStatus(): ChatGptWebStatus {
    const cfg = this.store.loadConfig()
    const marker = this.store.readVerifiedMarker()
    return { enabled: cfg.enabled, loggedIn: Boolean(marker?.authenticated), verifiedAt: marker?.verifiedAt ?? null }
  }

  setEnabled(enabled: boolean): ChatGptWebStatus {
    const cfg = this.store.loadConfig()
    this.store.saveConfig({ ...cfg, enabled })
    return this.getStatus()
  }

  async login(): Promise<ChatGptWebStatus> {
    const loginFn = this.deps.login ?? (await import('./browser-login')).loginToChatGptWeb
    const marker = await loginFn(this.store, this.store.userDataDir())
    this.store.writeVerifiedMarker(marker)
    return this.getStatus()
  }

  logout(): ChatGptWebStatus {
    const dir = this.store.userDataDir()
    rmSync(path.join(dir, 'storage-state.json'), { force: true })
    rmSync(path.join(dir, 'browser-profile'), { recursive: true, force: true })
    return this.getStatus()
  }

  getModelRefsIfActive(): ModelRef[] {
    const status = this.getStatus()
    return status.enabled && status.loggedIn ? getChatGptWebModelRefs() : []
  }

  getSessionStore(): ChatGptWebSessionStore {
    return this.store
  }
}
