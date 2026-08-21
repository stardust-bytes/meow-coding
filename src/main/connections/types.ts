import type { ProviderId } from '../../shared/types'

// Secrets are never persisted in account JSON; they live in the encrypted
// vault keyed by `conn:<accountId>:<field>`.
export interface ConnectionSecrets {
  tokens?: {
    accessToken: string
    refreshToken?: string
    idToken?: string
    expiresAt: number
    lastRefresh: number
  }
  apiKey?: string
}

export interface PendingLogin {
  loginId: string
  provider: ProviderId
  mode: 'browser-code' | 'callback'
  createdAt: number
  expiresAt: number
  codeVerifier?: string
  state?: string
  callbackPort?: number
}

export type LoginProgressStatus = 'started' | 'awaiting-code' | 'completed' | 'failed' | 'cancelled'
