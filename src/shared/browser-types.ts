export type BrowserStatus = 'idle' | 'listening' | 'paired' | 'disconnected' | 'error'

export interface BrowserStatusInfo {
  status: BrowserStatus
  port: number
  paired: boolean
  pairingCode?: string
  pairingExpiresAt?: number
}

export type BrowserCommandName =
  | 'navigate' | 'openTab' | 'switchTab' | 'closeTab' | 'reload' | 'listTabs'
  | 'click' | 'type' | 'select' | 'scroll' | 'read' | 'screenshot'
  | 'waitFor' | 'watchStart' | 'watchStop' | 'getConsoleLogs' | 'getNetworkLogs'

export interface BrowserCommand {
  id: string
  name: BrowserCommandName
  params?: Record<string, unknown>
}

export type BrowserCommandResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }

export type BrowserEventName = 'console' | 'network' | 'domChanged' | 'tabUpdated' | 'status'

export interface BrowserEvent {
  name: BrowserEventName
  data: unknown
}

export interface PairingInfo {
  code: string
  expiresAt: number
}

export interface PairMessage { type: 'pair'; code: string }
export interface PairResultMessage { type: 'pair_result'; ok: boolean; error?: string }
export interface CmdMessage extends BrowserCommand { type: 'cmd' }
export type ResultMessage = { type: 'result'; id: string } & BrowserCommandResult
export interface EventMessage extends BrowserEvent { type: 'event' }

export type ExtensionToBridge = PairMessage | ResultMessage | EventMessage
export type BridgeToExtension = PairResultMessage | CmdMessage | { type: 'pong' }
