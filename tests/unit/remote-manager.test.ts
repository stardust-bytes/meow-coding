import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { RemoteManager } from '../../src/main/remote/remote-manager'
import { RemotePairing } from '../../src/main/remote/remote-pairing'
import type { RemoteCommandContext } from '../../src/main/remote/remote-commands'
import type { RemoteSettings } from '../../src/main/remote/remote-settings'
import type { RemoteSettingsStore } from '../../src/main/remote/remote-settings'
import type { RelayClientDeps, RelayStatus } from '../../src/main/remote/remote-relay-client'
import type { ChatEvent } from '../../src/shared/types'

function makeStore(initial?: Partial<RemoteSettings>): RemoteSettingsStore {
  let current: RemoteSettings = {
    enabled: false,
    relayUrl: 'ws://relay.test',
    deviceId: 'dev-1',
    ...initial
  }
  return {
    load: () => current,
    save: (s: RemoteSettings) => {
      current = s
    }
  }
}

function makeContext(): RemoteCommandContext {
  return {
    meowAgent: {
      listAgents: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      switchSession: vi.fn(),
      renameSession: vi.fn(),
      send: vi.fn(),
      isRunning: vi.fn(),
      isBackground: vi.fn()
    },
    workspaceStore: { list: vi.fn() },
    isEnabled: vi.fn(() => true)
  }
}

function makeClient() {
  let statusCb: ((s: RelayStatus) => void) | null = null
  const client = {
    sendEvent: vi.fn(),
    startPairing: vi.fn(),
    revokeToken: vi.fn(),
    close: vi.fn(),
    onStatusChange: vi.fn((cb: (s: RelayStatus) => void) => {
      statusCb = cb
      return () => {
        if (statusCb === cb) statusCb = null
      }
    })
  }
  return {
    client,
    emitStatus: (s: RelayStatus) => statusCb?.(s)
  }
}

describe('RemoteManager', () => {
  let store: RemoteSettingsStore
  let pairing: RemotePairing
  let context: RemoteCommandContext
  let capturedDeps: RelayClientDeps | null
  let clients: ReturnType<typeof makeClient>[]
  let fake: ReturnType<typeof makeClient>
  let manager: RemoteManager

  beforeEach(() => {
    store = makeStore()
    pairing = new RemotePairing()
    context = makeContext()
    capturedDeps = null
    clients = []
    fake = makeClient()
    manager = new RemoteManager({
      store,
      pairing,
      context,
      createClient: (deps) => {
        capturedDeps = deps
        fake = makeClient()
        clients.push(fake)
        return fake.client as never
      }
    })
  })

  afterEach(() => {
    manager.dispose()
  })

  it('handleAgentEvent maps turn-started to agent:state running true', () => {
    ;(context.meowAgent.isBackground as ReturnType<typeof vi.fn>).mockReturnValue(true)
    manager.setEnabled(true)
    manager.handleAgentEvent({ type: 'turn-started', agentId: 'a1' })
    expect(fake.client.sendEvent).toHaveBeenCalledWith({
      type: 'agent:state',
      agentId: 'a1',
      running: true,
      background: true
    })
  })

  it('handleAgentEvent maps done to agent:state running false', () => {
    ;(context.meowAgent.isBackground as ReturnType<typeof vi.fn>).mockReturnValue(false)
    manager.setEnabled(true)
    manager.handleAgentEvent({ type: 'done', agentId: 'a1', reason: 'completed' })
    expect(fake.client.sendEvent).toHaveBeenCalledWith({
      type: 'agent:state',
      agentId: 'a1',
      running: false,
      background: false
    })
  })

  it('handleAgentEvent maps error to agent:state running false', () => {
    ;(context.meowAgent.isBackground as ReturnType<typeof vi.fn>).mockReturnValue(false)
    manager.setEnabled(true)
    manager.handleAgentEvent({ type: 'error', agentId: 'a1', message: 'boom' })
    expect(fake.client.sendEvent).toHaveBeenCalledWith({
      type: 'agent:state',
      agentId: 'a1',
      running: false,
      background: false
    })
  })

  it('handleAgentEvent passes other events through as chat:event', () => {
    manager.setEnabled(true)
    const e: ChatEvent = { type: 'text-delta', agentId: 'a1', delta: 'hi' }
    manager.handleAgentEvent(e)
    expect(fake.client.sendEvent).toHaveBeenCalledWith({ type: 'chat:event', event: e })
  })

  it('does not call sendEvent when no client exists', () => {
    manager.handleAgentEvent({ type: 'text-delta', agentId: 'a1', delta: 'hi' })
    expect(fake.client.sendEvent).not.toHaveBeenCalled()
  })

  it('setEnabled(false) closes the client and resets pairing', () => {
    manager.setEnabled(true)
    const issued = pairing.issueToken()
    manager.setEnabled(false)
    expect(fake.client.close).toHaveBeenCalled()
    expect(pairing.validateToken(issued)).toBe(false)
  })

  it('setEnabled(false) emits status with paired false', () => {
    const statuses: unknown[] = []
    manager.onStatusChange(s => statuses.push(s))
    manager.setEnabled(true)
    fake.emitStatus({ connected: true, paired: true })
    manager.setEnabled(false)
    const last = statuses[statuses.length - 1] as { enabled: boolean; paired: boolean; connected: boolean }
    expect(last.enabled).toBe(false)
    expect(last.paired).toBe(false)
    expect(last.connected).toBe(false)
  })

  it('startPairing returns null when disabled', () => {
    expect(manager.startPairing()).toBeNull()
    expect(fake.client.startPairing).not.toHaveBeenCalled()
  })

  it('startPairing returns null when enabled but not connected', () => {
    manager.setEnabled(true)
    expect(manager.startPairing()).toBeNull()
    expect(fake.client.startPairing).not.toHaveBeenCalled()
  })

  it('startPairing returns the code when connected', () => {
    manager.setEnabled(true)
    fake.emitStatus({ connected: true, paired: false })
    fake.client.startPairing.mockReturnValue({ code: '123456', expiresAt: 12345 })
    expect(manager.startPairing()).toEqual({ code: '123456', expiresAt: 12345 })
    expect(fake.client.startPairing).toHaveBeenCalledTimes(1)
  })

  it('onPairOk persists the session token into the store', () => {
    manager.setEnabled(true)
    expect(capturedDeps).not.toBeNull()
    capturedDeps!.onPairOk?.('tok-abc')
    expect(store.load().sessionToken).toBe('tok-abc')
  })

  it('revokeToken removes the session token from the store', () => {
    store.save({ ...store.load(), sessionToken: 'tok-abc' })
    manager.revokeToken()
    expect(store.load().sessionToken).toBeUndefined()
    expect(pairing.validateToken('tok-abc')).toBe(false)
  })

  it('getStatus exposes enabled, connected, paired and deviceId', () => {
    const status = manager.getStatus()
    expect(status.enabled).toBe(false)
    expect(status.connected).toBe(false)
    expect(status.paired).toBe(false)
    expect(status.deviceId).toBe('dev-1')
    manager.setEnabled(true)
    const after = manager.getStatus()
    expect(after.enabled).toBe(true)
    expect(after.deviceId).toBe('dev-1')
  })

  it('setRelayUrl reconnects when enabled', () => {
    manager.setEnabled(true)
    const first = clients[0].client
    manager.setRelayUrl('ws://other.test')
    expect(clients.length).toBe(2)
    expect(first.close).toHaveBeenCalled()
    expect(clients[1].client).not.toBe(first)
  })
})
