import { describe, expect, it } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi, PtyDataEvent, AgentStateEvent, GitStatusEvent, ChatEvent } from '../../src/shared/ipc'
import type { AgentConfig, ChatMessage, MeowSettings } from '../../src/shared/types'

describe('IPC contract', () => {
  it('defines all channels used by the preload api', () => {
    const required: (keyof AgentApi)[] = [
      'listWorkspaces', 'addWorkspace', 'removeWorkspace', 'openWorkspace',
      'addAgent', 'removeAgent', 'setAgentMode', 'listTemplates', 'saveTemplate', 'removeTemplate',
      'pickFolder', 'startAgent', 'stopAgent', 'restartAgent',
      'writeInput', 'injectPrompt', 'resizePty', 'openLog', 'getLogPath', 'quit',
      'onPtyData', 'onAgentState', 'onGitStatus',
      'sendChat', 'stopChat', 'newChatSession', 'listChatMessages', 'respondPrompt',
      'onChatEvent', 'getSettings', 'saveSettings', 'getMcpStatus'
    ]
    const api: AgentApi = {
      listWorkspaces: async () => [],
      addWorkspace: async () => null,
      removeWorkspace: async () => {},
      openWorkspace: async () => ({ workspace: { projectPath: '', name: '', agents: [] }, agents: [], git: null }),
      addAgent: async () => ({ workspace: { projectPath: '', name: '', agents: [] }, agents: [], git: null }),
      removeAgent: async () => {},
      setAgentMode: async () => {},
      listTemplates: async () => [],
      saveTemplate: async (t) => t,
      removeTemplate: async () => {},
      pickFolder: async () => null,
      startAgent: async () => {},
      stopAgent: async () => {},
      restartAgent: async () => {},
      writeInput: async () => {},
      injectPrompt: async () => {},
      resizePty: async () => {},
      openLog: async () => {},
      getLogPath: async () => '',
      quit: async () => {},
      onPtyData: () => () => {},
      onAgentState: () => () => {},
      onGitStatus: () => () => {},
      sendChat: async () => {},
      stopChat: async () => {},
      newChatSession: async () => {},
      listChatMessages: async () => [],
      respondPrompt: async () => {},
      onChatEvent: () => () => {},
      getSettings: async () => ({ providers: [], defaultProvider: '' }),
      saveSettings: async (s) => s,
      getMcpStatus: async () => []
    }
    for (const key of required) {
      expect(typeof api[key]).toBe('function')
    }
  })

  it('maps event channel names to the AgentApi method names', () => {
    expect(Channels.EventPtyData).toBe('pty:data')
    expect(Channels.EventAgentState).toBe('agent:state')
    expect(Channels.EventGitStatus).toBe('git:status')
    expect(Channels.PtyInput).toBe('pty:input')
    expect(Channels.ChatSend).toBe('chat:send')
    expect(Channels.ChatStop).toBe('chat:stop')
    expect(Channels.ChatNewSession).toBe('chat:new-session')
    expect(Channels.ChatListMessages).toBe('chat:list-messages')
    expect(Channels.ChatRespondPrompt).toBe('chat:respond-prompt')
    expect(Channels.EventChat).toBe('chat:event')
    expect(Channels.SettingsGet).toBe('settings:get')
    expect(Channels.SettingsSave).toBe('settings:save')
    expect(Channels.AgentSetMode).toBe('agent:set-mode')
    expect(Channels.McpStatus).toBe('mcp:status')
  })

  it('types event payloads without runtime error', () => {
    const d: PtyDataEvent = { agentId: 'a1', data: 'x' }
    const s: AgentStateEvent = { agentId: 'a1', state: {} as never }
    const gNull: GitStatusEvent = { projectPath: '/p', git: null }
    const g: GitStatusEvent = { projectPath: '/p', git: { branch: 'main', dirtyCount: 0 } }
    expect(d.data).toBe('x')
    expect(s.agentId).toBe('a1')
    expect(g.git.branch).toBe('main')
    expect(gNull.git).toBeNull()
  })

  it('types chat payloads without runtime error', () => {
    const msg: ChatMessage = { id: 'm1', role: 'user', text: 'hi', createdAt: 1 }
    const cfg: AgentConfig = { id: 'a1', name: 'meow', templateId: 'meow', cwd: '/p', kind: 'native' }
    const evt: ChatEvent = { type: 'text-delta', agentId: 'a1', delta: 'x' }
    const promptEvt: ChatEvent = {
      type: 'prompt-request', agentId: 'a1', promptId: 'p1',
      kind: 'permission', call: { id: 'c1', tool: 'bash', input: {}, permission: 'pending' }
    }
    expect(msg.role).toBe('user')
    expect(cfg.kind).toBe('native')
    expect(evt.type).toBe('text-delta')
    expect(promptEvt.type === 'prompt-request' && promptEvt.call?.tool).toBe('bash')
  })

  it('types settings payloads without runtime error', () => {
    const s: MeowSettings = {
      providers: [{ id: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
      defaultProvider: 'deepseek'
    }
    expect(s.providers[0].id).toBe('deepseek')
    expect(s.defaultProvider).toBe('deepseek')
  })
})
