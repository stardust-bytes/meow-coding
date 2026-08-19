import { describe, expect, it, vi } from 'vitest'
import { dispatchRemoteCommand, type RemoteCommandContext } from '../../src/main/remote/remote-commands'
import type { RemoteCommandName } from '../../src/shared/remote-types'

const ALL_COMMANDS: RemoteCommandName[] = [
  'workspace:list',
  'agent:list',
  'agent:state',
  'session:list',
  'session:create',
  'session:switch',
  'session:rename',
  'chat:send'
]

function makeCtx(overrides: Partial<RemoteCommandContext> = {}) {
  const meowAgent = {
    listAgents: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    renameSession: vi.fn(),
    send: vi.fn(async () => {}),
    isRunning: vi.fn(),
    isBackground: vi.fn()
  }
  const workspaceStore = { list: vi.fn() }
  const ctx: RemoteCommandContext = {
    meowAgent,
    workspaceStore,
    isEnabled: vi.fn(() => true),
    ...overrides
  }
  return { ctx, meowAgent, workspaceStore }
}

function agent(id: string, name: string) {
  return { id, name, templateId: 't1', cwd: `/work/${id}` }
}

describe('dispatchRemoteCommand', () => {
  it('returns remote disabled for every command and never calls the handlers', async () => {
    const { ctx, meowAgent, workspaceStore } = makeCtx({ isEnabled: vi.fn(() => false) })
    for (const cmd of ALL_COMMANDS) {
      const res = await dispatchRemoteCommand(cmd, { agentId: 'a1', sessionId: 's1', title: 'T', text: 'hi' }, ctx)
      expect(res).toEqual({ ok: false, error: 'remote disabled' })
    }
    expect(ctx.isEnabled).toHaveBeenCalledTimes(ALL_COMMANDS.length)
    const handlers = [
      meowAgent.listAgents, meowAgent.listSessions, meowAgent.createSession,
      meowAgent.switchSession, meowAgent.renameSession, meowAgent.send,
      meowAgent.isRunning, meowAgent.isBackground, workspaceStore.list
    ]
    for (const handler of handlers) expect(handler).not.toHaveBeenCalled()
  })

  it('workspace:list returns the workspaces from the store', async () => {
    const { ctx, workspaceStore } = makeCtx()
    const workspaces = [
      { projectPath: '/a', name: 'A', agentCount: 1 },
      { projectPath: '/b', name: 'B', agentCount: 2 }
    ]
    workspaceStore.list.mockReturnValue(workspaces)
    const res = await dispatchRemoteCommand('workspace:list', {}, ctx)
    expect(res).toEqual({ ok: true, result: workspaces })
  })

  it('agent:list returns only id, name, cwd and kind', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([
      { id: 'a1', name: 'One', templateId: 't1', cwd: '/work/one', kind: 'native', model: 'gpt-x', apiKey: 'secret' },
      { id: 'a2', name: 'Two', templateId: 't2', cwd: '/work/two' }
    ])
    const res = await dispatchRemoteCommand('agent:list', {}, ctx)
    expect(res).toEqual({
      ok: true,
      result: [
        { id: 'a1', name: 'One', cwd: '/work/one', kind: 'native' },
        { id: 'a2', name: 'Two', cwd: '/work/two', kind: undefined }
      ]
    })
  })

  it('agent:state returns running and background from the manager', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    meowAgent.isRunning.mockReturnValue(true)
    meowAgent.isBackground.mockReturnValue(false)
    const res = await dispatchRemoteCommand('agent:state', { agentId: 'a1' }, ctx)
    expect(meowAgent.isRunning).toHaveBeenCalledWith('a1')
    expect(meowAgent.isBackground).toHaveBeenCalledWith('a1')
    expect(res).toEqual({ ok: true, result: { running: true, background: false } })
  })

  it('agent:state errors for a nonexistent agent without calling the state methods', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const res = await dispatchRemoteCommand('agent:state', { agentId: 'nope' }, ctx)
    expect(res).toEqual({ ok: false, error: 'unknown agent: nope' })
    expect(meowAgent.isRunning).not.toHaveBeenCalled()
    expect(meowAgent.isBackground).not.toHaveBeenCalled()
  })

  it('session:list returns the sessions for the agent', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const sessions = [{ id: 's1', agentId: 'a1', title: 'S1', messageCount: 0, createdAt: 1, updatedAt: 2 }]
    meowAgent.listSessions.mockReturnValue(sessions)
    const res = await dispatchRemoteCommand('session:list', { agentId: 'a1' }, ctx)
    expect(meowAgent.listSessions).toHaveBeenCalledWith('a1')
    expect(res).toEqual({ ok: true, result: sessions })
  })

  it('session:create calls createSession and returns the summary', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const summary = { id: 's2', agentId: 'a1', title: 'S2', messageCount: 0, createdAt: 3, updatedAt: 4 }
    meowAgent.createSession.mockReturnValue(summary)
    const res = await dispatchRemoteCommand('session:create', { agentId: 'a1' }, ctx)
    expect(meowAgent.createSession).toHaveBeenCalledWith('a1')
    expect(res).toEqual({ ok: true, result: summary })
  })

  it('session:switch calls switchSession with the exact args', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const summary = { id: 's1', agentId: 'a1', title: 'S1', messageCount: 0, createdAt: 1, updatedAt: 2 }
    meowAgent.switchSession.mockReturnValue(summary)
    const res = await dispatchRemoteCommand('session:switch', { agentId: 'a1', sessionId: 's1' }, ctx)
    expect(meowAgent.switchSession).toHaveBeenCalledTimes(1)
    expect(meowAgent.switchSession).toHaveBeenCalledWith('a1', 's1')
    expect(res).toEqual({ ok: true, result: summary })
  })

  it('session:switch errors for a nonexistent agent without calling switchSession', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const res = await dispatchRemoteCommand('session:switch', { agentId: 'nope', sessionId: 's1' }, ctx)
    expect(res).toEqual({ ok: false, error: 'unknown agent: nope' })
    expect(meowAgent.switchSession).not.toHaveBeenCalled()
  })

  it('session:rename calls renameSession with agentId, sessionId and title', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const summary = { id: 's1', agentId: 'a1', title: 'New', messageCount: 1, createdAt: 1, updatedAt: 5 }
    meowAgent.renameSession.mockReturnValue(summary)
    const res = await dispatchRemoteCommand('session:rename', { agentId: 'a1', sessionId: 's1', title: 'New' }, ctx)
    expect(meowAgent.renameSession).toHaveBeenCalledWith('a1', 's1', 'New')
    expect(res).toEqual({ ok: true, result: summary })
  })

  it('chat:send calls send with the exact agentId and text and returns queued', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const res = await dispatchRemoteCommand('chat:send', { agentId: 'a1', text: 'hello there' }, ctx)
    expect(meowAgent.send).toHaveBeenCalledTimes(1)
    expect(meowAgent.send).toHaveBeenCalledWith('a1', 'hello there')
    expect(res).toEqual({ ok: true, result: { queued: true } })
  })

  it('chat:send rejects empty text without calling send', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    const res = await dispatchRemoteCommand('chat:send', { agentId: 'a1', text: '   ' }, ctx)
    expect(res).toEqual({ ok: false, error: 'text is required' })
    expect(meowAgent.send).not.toHaveBeenCalled()
  })

  it('returns an error for an unknown command', async () => {
    const { ctx } = makeCtx()
    const res = await dispatchRemoteCommand('bogus:cmd' as RemoteCommandName, {}, ctx)
    expect(res).toEqual({ ok: false, error: 'unknown command' })
  })

  it('returns missing required param when agentId is absent', async () => {
    const { ctx, meowAgent } = makeCtx()
    const res = await dispatchRemoteCommand('agent:state', {}, ctx)
    expect(res).toEqual({ ok: false, error: 'missing required param: agentId' })
    expect(meowAgent.isRunning).not.toHaveBeenCalled()
  })

  it('wraps a throwing handler into an error result instead of rejecting', async () => {
    const { ctx, meowAgent } = makeCtx()
    meowAgent.listAgents.mockReturnValue([agent('a1', 'One')])
    meowAgent.listSessions.mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await dispatchRemoteCommand('session:list', { agentId: 'a1' }, ctx)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('boom')
  })
})
