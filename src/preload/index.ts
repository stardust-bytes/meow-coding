import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/ipc'
import type { ChatEvent, Command, ContextChangedEvent, MeowSettings, NewAgentInput, PromptResponse, Template } from '../shared/types'
import type { AgentApi, AgentStateEvent, GitStatusEvent, PtyDataEvent, WindowMaximizedChangeEvent } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AgentApi = {
  listWorkspaces: () => ipcRenderer.invoke(Channels.WorkspaceList),
  addWorkspace: (projectPath: string, name: string) =>
    ipcRenderer.invoke(Channels.WorkspaceAdd, projectPath, name),
  removeWorkspace: (projectPath: string) =>
    ipcRenderer.invoke(Channels.WorkspaceRemove, projectPath),
  openWorkspace: (projectPath: string) =>
    ipcRenderer.invoke(Channels.WorkspaceOpen, projectPath),
  openInEditor: (projectPath: string) =>
    ipcRenderer.invoke(Channels.ProjectOpenInEditor, projectPath),
  addAgent: (projectPath: string, input: NewAgentInput) =>
    ipcRenderer.invoke(Channels.AgentAdd, projectPath, input),
  removeAgent: (projectPath: string, agentId: string) =>
    ipcRenderer.invoke(Channels.AgentRemove, projectPath, agentId),
  setAgentMode: (agentId: string, mode: 'build' | 'plan') =>
    ipcRenderer.invoke(Channels.AgentSetMode, agentId, mode),
  setAgentVariant: (agentId: string, variant: string | null) =>
    ipcRenderer.invoke(Channels.AgentSetVariant, agentId, variant),
  getAgentVariants: (agentId: string) =>
    ipcRenderer.invoke(Channels.AgentGetVariants, agentId),
  setAgentModel: (agentId: string, provider: string, model: string) =>
    ipcRenderer.invoke(Channels.AgentSetModel, agentId, provider, model),
  getAgentModel: (agentId: string) => ipcRenderer.invoke(Channels.AgentGetModel, agentId),
  getContextInfo: (agentId: string) => ipcRenderer.invoke(Channels.AgentGetContext, agentId),
  getProviderModels: () => ipcRenderer.invoke(Channels.ProviderModels),
  fetchProviderModels: (providerId: string) => ipcRenderer.invoke(Channels.ProviderFetchModels, providerId),
  listProviderCatalog: () => ipcRenderer.invoke(Channels.ProviderCatalog),
  connectProvider: (providerId: string, apiKey: string, baseUrl?: string) =>
    ipcRenderer.invoke(Channels.ProviderConnect, providerId, apiKey, baseUrl),
  disconnectProvider: (providerId: string) => ipcRenderer.invoke(Channels.ProviderDisconnect, providerId),
  listTemplates: () => ipcRenderer.invoke(Channels.TemplateList),
  saveTemplate: (template: Template) => ipcRenderer.invoke(Channels.TemplateSave, template),
  removeTemplate: (id: string) => ipcRenderer.invoke(Channels.TemplateRemove, id),
  pickFolder: () => ipcRenderer.invoke(Channels.PickFolder),
  startAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyStart, agentId),
  stopAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyStop, agentId),
  restartAgent: (agentId: string) => ipcRenderer.invoke(Channels.PtyRestart, agentId),
  writeInput: (agentId: string, data: string) =>
    ipcRenderer.invoke(Channels.PtyInput, agentId, data),
  injectPrompt: (agentId: string, text: string) =>
    ipcRenderer.invoke(Channels.PtyInject, agentId, text),
  resizePty: (agentId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(Channels.PtyResize, agentId, cols, rows),
  openLog: (agentId: string) => ipcRenderer.invoke(Channels.LogOpen, agentId),
  getLogPath: (agentId: string) => ipcRenderer.invoke(Channels.LogPath, agentId),
  quit: () => ipcRenderer.invoke(Channels.AppQuit),
  sendChat: (agentId: string, text: string) =>
    ipcRenderer.invoke(Channels.ChatSend, agentId, text),
  stopChat: (agentId: string) => ipcRenderer.invoke(Channels.ChatStop, agentId),
  runCommand: (agentId: string, name: string, args: string[]) =>
    ipcRenderer.invoke(Channels.ChatRunCommand, agentId, name, args),
  undoChat: (agentId: string) => ipcRenderer.invoke(Channels.ChatUndo, agentId),
  redoChat: (agentId: string) => ipcRenderer.invoke(Channels.ChatRedo, agentId),
  newChatSession: (agentId: string) => ipcRenderer.invoke(Channels.ChatNewSession, agentId),
  listChatMessages: (agentId: string) => ipcRenderer.invoke(Channels.ChatListMessages, agentId),
  listChatTranscript: (agentId: string) => ipcRenderer.invoke(Channels.ChatListTranscript, agentId),
  getChatTodos: (agentId: string) => ipcRenderer.invoke(Channels.ChatGetTodos, agentId),
  respondPrompt: (agentId: string, promptId: string, resp: PromptResponse) =>
    ipcRenderer.invoke(Channels.ChatRespondPrompt, agentId, promptId, resp),
  listSessions: (agentId: string) => ipcRenderer.invoke(Channels.SessionList, agentId),
  createSession: (agentId: string) => ipcRenderer.invoke(Channels.SessionCreate, agentId),
  switchSession: (agentId: string, sessionId: string) =>
    ipcRenderer.invoke(Channels.SessionSwitch, agentId, sessionId),
  deleteSession: (agentId: string, sessionId: string) =>
    ipcRenderer.invoke(Channels.SessionDelete, agentId, sessionId),
  renameSession: (agentId: string, sessionId: string, title: string) =>
    ipcRenderer.invoke(Channels.SessionRename, agentId, sessionId, title),
  getSettings: () => ipcRenderer.invoke(Channels.SettingsGet),
  saveSettings: (settings: MeowSettings) => ipcRenderer.invoke(Channels.SettingsSave, settings),
  listCommands: (projectPath: string) => ipcRenderer.invoke(Channels.CommandList, projectPath),
  saveCommand: (command: Command) => ipcRenderer.invoke(Channels.CommandSave, command),
  removeCommand: (name: string) => ipcRenderer.invoke(Channels.CommandRemove, name),
  getStats: () => ipcRenderer.invoke(Channels.StatsGet),
  getMcpStatus: () => ipcRenderer.invoke(Channels.McpStatus),
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.invoke(Channels.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(Channels.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(Channels.WindowClose),
  isWindowMaximized: () => ipcRenderer.invoke(Channels.WindowIsMaximized),
  onWindowMaximizedChange: (cb: (e: WindowMaximizedChangeEvent) => void) =>
    subscribe(Channels.EventWindowMaximizedChange, cb),
  onPtyData: (cb: (e: PtyDataEvent) => void) => subscribe(Channels.EventPtyData, cb),
  onAgentState: (cb: (e: AgentStateEvent) => void) => subscribe(Channels.EventAgentState, cb),
  onGitStatus: (cb: (e: GitStatusEvent) => void) => subscribe(Channels.EventGitStatus, cb),
  onContextChanged: (cb: (e: ContextChangedEvent) => void) => subscribe(Channels.EventContextChanged, cb),
  onChatEvent: (cb: (e: ChatEvent) => void) => subscribe(Channels.EventChat, cb)
}

contextBridge.exposeInMainWorld('api', api)
