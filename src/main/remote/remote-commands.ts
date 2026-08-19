import type { MeowAgentManager } from '../meow-agent-manager'
import type { WorkspaceStore } from '../workspace-store'
import type { RemoteCommandName, RemoteCmdResult } from '../../shared/remote-types'

export type RemoteCommandResult = Omit<RemoteCmdResult, 'type' | 'id'>

export interface RemoteCommandContext {
  meowAgent: Pick<MeowAgentManager, 'listAgents' | 'listSessions' | 'createSession' | 'switchSession' |
    'renameSession' | 'listMessages' | 'send' | 'isRunning' | 'isBackground'>
  workspaceStore: Pick<WorkspaceStore, 'list'>
  isEnabled(): boolean
}

export async function dispatchRemoteCommand(
  name: RemoteCommandName,
  params: Record<string, unknown>,
  ctx: RemoteCommandContext
): Promise<RemoteCommandResult> {
  if (!ctx.isEnabled()) return { ok: false, error: 'remote disabled' }
  const agentId = typeof params.agentId === 'string' ? params.agentId : undefined
  const agentError = (): { ok: false; error: string } | null => {
    if (!agentId) return { ok: false, error: 'missing required param: agentId' }
    if (!ctx.meowAgent.listAgents().some(a => a.id === agentId)) {
      return { ok: false, error: `unknown agent: ${agentId}` }
    }
    return null
  }
  try {
    switch (name) {
      case 'workspace:list':
        return { ok: true, result: ctx.workspaceStore.list() }
      case 'agent:list':
        return {
          ok: true,
          result: ctx.meowAgent.listAgents().map(a => ({ id: a.id, name: a.name, cwd: a.cwd, kind: a.kind }))
        }
      case 'agent:state': {
        const missing = agentError()
        if (missing) return missing
        return {
          ok: true,
          result: { running: ctx.meowAgent.isRunning(agentId!), background: ctx.meowAgent.isBackground(agentId!) }
        }
      }
      case 'session:list': {
        const missing = agentError()
        if (missing) return missing
        return { ok: true, result: ctx.meowAgent.listSessions(agentId!) }
      }
      case 'session:create': {
        const missing = agentError()
        if (missing) return missing
        return { ok: true, result: ctx.meowAgent.createSession(agentId!) }
      }
      case 'session:switch': {
        const missing = agentError()
        if (missing) return missing
        if (typeof params.sessionId !== 'string') return { ok: false, error: 'missing required param: sessionId' }
        return { ok: true, result: ctx.meowAgent.switchSession(agentId!, params.sessionId) }
      }
      case 'session:rename': {
        const missing = agentError()
        if (missing) return missing
        if (typeof params.sessionId !== 'string') return { ok: false, error: 'missing required param: sessionId' }
        if (typeof params.title !== 'string') return { ok: false, error: 'missing required param: title' }
        return { ok: true, result: ctx.meowAgent.renameSession(agentId!, params.sessionId, params.title) }
      }
      case 'session:messages': {
        const missing = agentError()
        if (missing) return missing
        return { ok: true, result: ctx.meowAgent.listMessages(agentId!) }
      }
      case 'chat:send': {
        const missing = agentError()
        if (missing) return missing
        if (typeof params.text !== 'string' || !params.text.trim()) return { ok: false, error: 'text is required' }
        await ctx.meowAgent.send(agentId!, params.text)
        return { ok: true, result: { queued: true } }
      }
      default:
        return { ok: false, error: 'unknown command' }
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
