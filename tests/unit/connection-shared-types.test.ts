import { describe, expect, it, vi } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi } from '../../src/shared/ipc'
import type { ConnectionAccount, ModelRef } from '../../src/shared/types'

describe('connection shared contracts', () => {
  it('declares typed connection channels', () => {
    expect(Channels.ConnectionList).toBe('connections:list')
    expect(Channels.ConnectionConnectCodex).toBe('connections:connect-codex')
    expect(Channels.ConnectionDisconnect).toBe('connections:disconnect')
    expect(Channels.ConnectionSetActive).toBe('connections:set-active')
    expect(Channels.ConnectionGetModels).toBe('connections:get-models')
  })

  it('declares typed connection operations on AgentApi', () => {
    const api: AgentApi = {
      listConnections: async () => [],
      connectCodex: async () => ({ id: 'a', provider: 'codex', displayName: 'a', active: false, createdAt: '', status: 'ready' }),
      disconnectConnection: async () => [],
      setActiveConnection: async () => [],
      getConnectionModels: async () => []
    }
    expect(typeof api.listConnections).toBe('function')
    expect(typeof api.connectCodex).toBe('function')
    expect(typeof api.disconnectConnection).toBe('function')
    expect(typeof api.setActiveConnection).toBe('function')
    expect(typeof api.getConnectionModels).toBe('function')
  })

  it('models a Codex connection account without secrets', () => {
    const account: ConnectionAccount = {
      id: 'codex-account-1',
      provider: 'codex',
      email: 'dev@example.com',
      displayName: 'dev@example.com',
      active: true,
      createdAt: '2026-08-25T00:00:00.000Z',
      status: 'ready'
    }
    expect(account.provider).toBe('codex')
    expect(account.active).toBe(true)
    expect(account).not.toHaveProperty('accessToken')
    expect(account).not.toHaveProperty('refreshToken')
    expect(account).not.toHaveProperty('code')
  })

  it('carries accountId and accountLabel on the account-aware ModelRef', () => {
    const ref: ModelRef = {
      provider: 'codex',
      accountId: 'codex-account-1',
      accountLabel: 'dev@example.com',
      model: 'gpt-5.3-codex'
    }
    expect(ref.provider).toBe('codex')
    expect(ref.accountId).toBe('codex-account-1')
    expect(ref.accountLabel).toBe('dev@example.com')
    expect(ref.model).toBe('gpt-5.3-codex')
  })

  it('keeps provider-only ModelRefs working without account fields', () => {
    const ref: ModelRef = { provider: 'openai', model: 'gpt-4o' }
    expect(ref.accountId).toBeUndefined()
  })

  it('calls setAgentModel with a single account-aware ModelRef', () => {
    const windowApi: Pick<AgentApi, 'setAgentModel'> = { setAgentModel: vi.fn() }
    windowApi.setAgentModel(
      'agent-1',
      { provider: 'codex', accountId: 'codex-account-1', model: 'gpt-5.3-codex' }
    )
    expect(windowApi.setAgentModel).toHaveBeenCalledWith(
      'agent-1',
      { provider: 'codex', accountId: 'codex-account-1', model: 'gpt-5.3-codex' }
    )
  })
})
