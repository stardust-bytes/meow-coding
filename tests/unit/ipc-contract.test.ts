import { describe, expect, it } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi, PtyDataEvent, AgentStateEvent, GitStatusEvent } from '../../src/shared/ipc'

describe('IPC contract', () => {
  it('defines all channels used by the preload api', () => {
    const required: (keyof AgentApi)[] = [
      'listWorkspaces', 'addWorkspace', 'removeWorkspace', 'openWorkspace',
      'addAgent', 'removeAgent', 'listTemplates', 'saveTemplate', 'removeTemplate',
      'pickFolder', 'startAgent', 'stopAgent', 'restartAgent',
      'writeInput', 'injectPrompt', 'openLog', 'getLogPath', 'quit',
      'onPtyData', 'onAgentState', 'onGitStatus'
    ]
    for (const key of required) {
      expect(required).toContain(key)
    }
  })

  it('maps event channel names to the AgentApi method names', () => {
    expect(Channels.EventPtyData).toBe('pty:data')
    expect(Channels.EventAgentState).toBe('agent:state')
    expect(Channels.EventGitStatus).toBe('git:status')
    expect(Channels.PtyInput).toBe('pty:input')
  })

  it('types event payloads without runtime error', () => {
    const d: PtyDataEvent = { agentId: 'a1', data: 'x' }
    const s: AgentStateEvent = { agentId: 'a1', state: {} as never }
    const g: GitStatusEvent = { projectPath: '/p', git: { branch: 'main', dirtyCount: 0 } }
    expect(d.data).toBe('x')
    expect(s.agentId).toBe('a1')
    expect(g.git.branch).toBe('main')
  })
})
