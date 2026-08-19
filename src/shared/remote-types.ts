import type { ChatEvent } from './types'

export type RemoteCommandName =
  | 'workspace:list' | 'agent:list' | 'agent:state'
  | 'session:list' | 'session:switch' | 'session:create' | 'session:rename'
  | 'session:messages'
  | 'chat:send' | 'chat:respond'

export type RemoteEvent =
  | { type: 'agent:state'; agentId: string; running: boolean; background: boolean }
  | { type: 'session:changed'; agentId: string }
  | { type: 'chat:event'; event: ChatEvent }

export interface RemoteHello {
  type: 'hello'
  role: 'desktop' | 'mobile'
  deviceId: string
  auth?: string
}

export interface RemotePairingStart {
  type: 'pairing-start'
  code: string
  ttlMs: number
}

export interface RemotePairResult {
  type: 'pair-result'
  ok: boolean
  token?: string
  error?: string
}

export interface RemoteCmd {
  type: 'cmd'
  id: string
  cmd: RemoteCommandName
  params: Record<string, unknown>
}

export interface RemoteCmdResult {
  type: 'cmd-result'
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface RemoteEventMsg {
  type: 'event'
  event: RemoteEvent
}

export type RemoteEnvelope =
  | RemoteHello
  | RemotePairingStart
  | RemoteCmd
  | RemotePairResult
  | RemoteCmdResult
  | RemoteEventMsg
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'desktop-status'; online: boolean }

export interface RemoteStatus {
  enabled: boolean
  connected: boolean
  paired: boolean
  deviceId: string
  relayUrl?: string
  pairingCode?: string
  pairingExpiresAt?: number
  mobileOnline?: boolean
  error?: string
}
