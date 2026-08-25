import type { ConnectionProviderId } from '../../shared/types'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  /** ISO timestamp when the access token expires. */
  accessTokenExpiresAt: string
}

export interface CodexProfile {
  email?: string
  displayName: string
}

/** Private sidecar wire response; this is never exposed through shared IPC. */
export interface CodexModelCatalogResponse {
  data: CodexModelCatalogItem[]
}

export interface CodexModelCatalogItem {
  id: string
  name: string
  variants: string[]
}

export type ConnectionSecretRef = `connection:${ConnectionProviderId}:${string}`

export function connectionSecretRef(provider: ConnectionProviderId, accountId: string): ConnectionSecretRef {
  return `connection:${provider}:${accountId}`
}
