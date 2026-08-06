import { describe, expect, it } from 'vitest'
import { Channels } from '../../src/shared/ipc'
import type { AgentApi, PtyDataEvent, AgentStateEvent, GitStatusEvent, ChatEvent } from '../../src/shared/ipc'
import type { AgentConfig, ChatMessage, MeowSettings } from '../../src/shared/types'

describe('IPC contract', () => {
  it('defines all channels used by the preload api', () => {
    const required: (keyof AgentApi)[] = [
      'listWorkspaces', 'addWorkspace', 'removeWorkspace', 'openWorkspace', 'openInEditor',
      'addAgent', 'removeAgent', 'setAgentMode', 'setAgentVariant', 'getAgentVariants', 'setAgentModel', 'getAgentModel', 'getContextInfo', 'getProviderModels', 'fetchProviderModels',
      'listProviderCatalog', 'connectProvider', 'disconnectProvider',
      'listTemplates', 'saveTemplate', 'removeTemplate',
      'pickFolder', 'startAgent', 'stopAgent', 'restartAgent',
      'writeInput', 'injectPrompt', 'resizePty', 'openLog', 'getLogPath', 'quit', 'getAppVersion',
      'onPtyData', 'onAgentState', 'onGitStatus',
      'sendChat', 'stopChat', 'runCommand', 'undoChat', 'redoChat', 'newChatSession', 'listChatMessages', 'listChatTranscript', 'respondPrompt',
      'onChatEvent', 'getSettings', 'saveSettings', 'getMcpStatus', 'listCommands', 'saveCommand', 'removeCommand', 'getStats', 'onContextChanged',
      'suggestFiles', 'setAgentBackground', 'onAgentBackground',
      'listSessions', 'createSession', 'switchSession', 'deleteSession', 'renameSession',
      'getChatTodos',
      'minimizeWindow', 'toggleMaximizeWindow', 'closeWindow', 'isWindowMaximized', 'onWindowMaximizedChange'
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
      getAgentVariants: async () => [],
      setAgentModel: async () => {},
      getAgentModel: async () => null,
      getContextInfo: async () => ({ limit: null, compactThreshold: null, sessionCost: 0 }),
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
      getAppVersion: async () => '0.0.0',
      onPtyData: () => () => {},
      onAgentState: () => () => {},
      onGitStatus: () => () => {},
      sendChat: async () => {},
      stopChat: async () => {},
      runCommand: async () => {},
      undoChat: async () => true,
      redoChat: async () => true,
      newChatSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      listChatMessages: async () => [],
      listChatTranscript: async () => [],
      getChatTodos: async () => [],
      respondPrompt: async () => {},
      onChatEvent: () => () => {},
      getSettings: async () => ({ providers: [], defaultProvider: '', agents: [], permission: {}, mcp: {}, maxContextTokens: 200000, maxSteps: Infinity, compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000 }, toolOutput: { maxBytes: 51200, maxLines: 2000 }, lsp: { enabled: true, diagnosticsTimeoutMs: 3000 } }),
      saveSettings: async (s) => s,
      getMcpStatus: async () => [],
      platform: 'win32',
      minimizeWindow: async () => {},
      toggleMaximizeWindow: async () => {},
      closeWindow: async () => {},
      isWindowMaximized: async () => false,
      onWindowMaximizedChange: () => () => {},
      listCommands: async () => [],
      saveCommand: async (c) => c,
      removeCommand: async () => {},
      getStats: async () => ({ totalCost: 0, totalTokens: 0, perModel: {}, perSession: [] }),
      onContextChanged: () => () => {},
      suggestFiles: async () => [],
      setAgentBackground: async () => {},
      onAgentBackground: () => () => {},
      listSessions: async () => [],
      createSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      switchSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      deleteSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 }),
      renameSession: async () => ({ id: '', agentId: '', title: '', messageCount: 0, createdAt: 0, updatedAt: 0 })
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
    expect(Channels.FilesSuggest).toBe('files:suggest')
    expect(Channels.AgentSetBackground).toBe('agent:set-background')
    expect(Channels.EventAgentBackground).toBe('agent:background')
    expect(Channels.AppVersion).toBe('app:version')
    expect(Channels.SessionList).toBe('session:list')
    expect(Channels.SessionCreate).toBe('session:create')
    expect(Channels.SessionSwitch).toBe('session:switch')
    expect(Channels.SessionDelete).toBe('session:delete')
    expect(Channels.SettingsGet).toBe('settings:get')
    expect(Channels.SettingsSave).toBe('settings:save')
    expect(Channels.CommandList).toBe('commands:list')
    expect(Channels.CommandSave).toBe('commands:save')
    expect(Channels.CommandRemove).toBe('commands:remove')
    expect(Channels.StatsGet).toBe('stats:get')
    expect(Channels.EventContextChanged).toBe('context:changed')
    expect(Channels.ChatRunCommand).toBe('chat:run-command')
    expect(Channels.AgentSetMode).toBe('agent:set-mode')
    expect(Channels.AgentSetVariant).toBe('agent:set-variant')
    expect(Channels.AgentGetVariants).toBe('agent:get-variants')
    expect(Channels.AgentSetModel).toBe('agent:set-model')
    expect(Channels.AgentGetModel).toBe('agent:get-model')
    expect(Channels.AgentGetContext).toBe('agent:get-context')
    expect(Channels.ProviderModels).toBe('provider:models')
    expect(Channels.ProviderFetchModels).toBe('provider:fetch-models')
    expect(Channels.ProviderCatalog).toBe('provider:catalog')
    expect(Channels.ProviderConnect).toBe('provider:connect')
    expect(Channels.ProviderDisconnect).toBe('provider:disconnect')
    expect(Channels.McpStatus).toBe('mcp:status')
    expect(Channels.WindowMinimize).toBe('window:minimize')
    expect(Channels.WindowToggleMaximize).toBe('window:toggle-maximize')
    expect(Channels.WindowClose).toBe('window:close')
    expect(Channels.WindowIsMaximized).toBe('window:is-maximized')
    expect(Channels.EventWindowMaximizedChange).toBe('window:maximized-change')
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
