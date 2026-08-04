import { describe, expect, it } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi, PtyDataEvent, AgentStateEvent, GitStatusEvent, ChatEvent } from '../../src/shared/ipc'
import type { AgentConfig, ChatMessage, MeowSettings } from '../../src/shared/types'

describe('IPC contract', () => {
  it('defines all channels used by the preload api', () => {
    const required: (keyof AgentApi)[] = [
      'listWorkspaces', 'addWorkspace', 'removeWorkspace', 'openWorkspace', 'openInEditor',
      'addAgent', 'removeAgent', 'setAgentMode', 'setAgentVariant', 'setAgentModel', 'getAgentModel', 'getProviderModels', 'fetchProviderModels',
      'listProviderCatalog', 'connectProvider', 'disconnectProvider',
      'listTemplates', 'saveTemplate', 'removeTemplate',
      'pickFolder', 'startAgent', 'stopAgent', 'restartAgent',
      'writeInput', 'injectPrompt', 'resizePty', 'openLog', 'getLogPath', 'quit',
      'onPtyData', 'onAgentState', 'onGitStatus',
      'sendChat', 'stopChat', 'newChatSession', 'listChatMessages', 'listChatTranscript', 'respondPrompt',
      'onChatEvent', 'getSettings', 'saveSettings', 'getMcpStatus',
      'listSessions', 'createSession', 'switchSession', 'deleteSession',
      'getChatTodos'
    ]
    const api: AgentApi = {
      listWorkspaces: async () => [],
      addWorkspace: async () => null,
      removeWorkspace: async () => {},
      openWorkspace: async () => ({ workspace: { projectPath: '', name: '', agents: [] }, agents: [], git: null }),
      openInEditor: async () => {},
      addAgent: async () => ({ workspace: { projectPath: '', name: '', agents: [] }, agents: [], git: null }),
      removeAgent: async () => {},
      setAgentMode: async () => {},
      setAgentVariant: async () => {},
      setAgentModel: async () => {},
      getAgentModel: async () => null,
      getProviderModels: async () => [],
      fetchProviderModels: async () => [],
      listProviderCatalog: async () => [],
      connectProvider: async () => ({ providers: [], defaultProvider: '' }),
      disconnectProvider: async () => ({ providers: [], defaultProvider: '' }),
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
      newChatSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      listChatMessages: async () => [],
      listChatTranscript: async () => [],
      getChatTodos: async () => [],
      respondPrompt: async () => {},
      onChatEvent: () => () => {},
      getSettings: async () => ({ providers: [], defaultProvider: '' }),
      saveSettings: async (s) => s,
      getMcpStatus: async () => [],
      listSessions: async () => [],
      createSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      switchSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      deleteSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 })
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
    expect(Channels.ChatListTranscript).toBe('chat:list-transcript')
    expect(Channels.ChatRespondPrompt).toBe('chat:respond-prompt')
    expect(Channels.EventChat).toBe('chat:event')
    expect(Channels.SessionList).toBe('session:list')
    expect(Channels.SessionCreate).toBe('session:create')
    expect(Channels.SessionSwitch).toBe('session:switch')
    expect(Channels.SessionDelete).toBe('session:delete')
    expect(Channels.SettingsGet).toBe('settings:get')
    expect(Channels.SettingsSave).toBe('settings:save')
    expect(Channels.AgentSetMode).toBe('agent:set-mode')
    expect(Channels.AgentSetVariant).toBe('agent:set-variant')
    expect(Channels.AgentSetModel).toBe('agent:set-model')
    expect(Channels.AgentGetModel).toBe('agent:get-model')
    expect(Channels.ProviderModels).toBe('provider:models')
    expect(Channels.ProviderFetchModels).toBe('provider:fetch-models')
    expect(Channels.ProviderCatalog).toBe('provider:catalog')
    expect(Channels.ProviderConnect).toBe('provider:connect')
    expect(Channels.ProviderDisconnect).toBe('provider:disconnect')
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
