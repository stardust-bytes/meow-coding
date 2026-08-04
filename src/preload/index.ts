import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/ipc'
import type { ChatEvent, MeowSettings, NewAgentInput, PromptResponse, Template } from '../shared/types'
import type { AgentApi, AgentStateEvent, GitStatusEvent, PtyDataEvent } from '../shared/ipc'

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
  addAgent: (projectPath: string, input: NewAgentInput) =>
    ipcRenderer.invoke(Channels.AgentAdd, projectPath, input),
  removeAgent: (projectPath: string, agentId: string) =>
    ipcRenderer.invoke(Channels.AgentRemove, projectPath, agentId),
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
  newChatSession: (agentId: string) => ipcRenderer.invoke(Channels.ChatNewSession, agentId),
  listChatMessages: (agentId: string) => ipcRenderer.invoke(Channels.ChatListMessages, agentId),
  respondPrompt: (agentId: string, promptId: string, resp: PromptResponse) =>
    ipcRenderer.invoke(Channels.ChatRespondPrompt, agentId, promptId, resp),
  getSettings: () => ipcRenderer.invoke(Channels.SettingsGet),
  saveSettings: (settings: MeowSettings) => ipcRenderer.invoke(Channels.SettingsSave, settings),
  onPtyData: (cb: (e: PtyDataEvent) => void) => subscribe(Channels.EventPtyData, cb),
  onAgentState: (cb: (e: AgentStateEvent) => void) => subscribe(Channels.EventAgentState, cb),
  onGitStatus: (cb: (e: GitStatusEvent) => void) => subscribe(Channels.EventGitStatus, cb),
  onChatEvent: (cb: (e: ChatEvent) => void) => subscribe(Channels.EventChat, cb)
}

contextBridge.exposeInMainWorld('api', api)
