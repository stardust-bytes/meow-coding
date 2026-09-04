import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings, Template } from '@shared/types'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import TemplatesTab from './TemplatesTab'
import UpdatesTab from './UpdatesTab'
import ProvidersTab from './ProvidersTab'
import PersonalizeTab from './PersonalizeTab'

export type TabId = 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'templates' | 'updates' | 'providers' | 'personalize'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'providers', label: 'Providers' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' },
  { id: 'updates', label: 'Updates' },
  { id: 'personalize', label: 'Personalize' }
]

interface Props {
  onClose: () => void
  projectPath?: string
  templates: Template[]
  onTemplatesChange: (templates: Template[]) => void
  initialTab?: TabId
  /** First registered agent, used to fetch the context limit for "auto ≈" placeholders. */
  agentId?: string
}

export default function SettingsDialog({ onClose, projectPath, templates, onTemplatesChange, initialTab = 'agents', agentId }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [draft, setDraft] = useState<MeowSettings | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [resolvedContextTokens, setResolvedContextTokens] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const draftRef = useRef<MeowSettings | null>(null)
  const lastPersistedRef = useRef('')
  const screenRef = useRef<HTMLElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [settings, mcps, nextCatalog] = await Promise.all([
        window.api.getSettings(),
        window.api.getMcpStatus(),
        window.api.listProviderCatalog()
      ])
      lastPersistedRef.current = JSON.stringify(settings)
      setDraft(settings)
      setMcpStatus(mcps)
      setCatalog(nextCatalog)
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Context limit for the "auto ≈" placeholders in the Context tab. No agent
  // id (no workspace open) → null, and the placeholders fall back to "auto".
  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    void window.api.getContextInfo(agentId).then(info => {
      if (!cancelled) setResolvedContextTokens(info.limit)
    })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const doSave = useCallback(async () => {
    const current = draftRef.current
    if (!current || savingRef.current) {
      pendingRef.current = true
      return
    }
    savingRef.current = true
    setSaveState('saving')
    try {
      const result = await window.api.saveSettings(current)
      // Only adopt the normalized result if the draft hasn't moved on while
      // the save was in flight. saveSettings can be slow (it reloads agents /
      // reconnects MCP), so overwriting unconditionally would silently drop
      // edits made during the save — the pending save below would then persist
      // the stale value.
      if (draftRef.current === current) {
        draftRef.current = result
        lastPersistedRef.current = JSON.stringify(result)
        setDraft(result)
      }
      setMcpStatus(await window.api.getMcpStatus())
      setSaveState('saved')
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
    } finally {
      savingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void doSave()
      }
    }
  }, [])

  useEffect(() => {
    if (!draft) return
    if (JSON.stringify(draft) === lastPersistedRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSaveState('idle')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, 500)
  }, [draft, doSave])

  // Flush any pending save when the dialog unmounts so edits are never lost.
  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      const current = draftRef.current
      if (current && JSON.stringify(current) !== lastPersistedRef.current) {
        void window.api.saveSettings(current)
      }
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const id = window.setTimeout(() => setSaveState('idle'), 2000)
    return () => window.clearTimeout(id)
  }, [saveState])

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const app = document.querySelector('.app')
    const previousAriaHidden = app ? app.getAttribute('aria-hidden') : null
    app?.setAttribute('aria-hidden', 'true')
    const frame = window.requestAnimationFrame(() => backButtonRef.current?.focus())

    return () => {
      window.cancelAnimationFrame(frame)
      if (previousAriaHidden === null) app?.removeAttribute('aria-hidden')
      else if (app) app.setAttribute('aria-hidden', previousAriaHidden)
      previousFocusRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.settings-screen .dialog-backdrop')) onClose()
      if (e.key !== 'Tab' || document.querySelector('.settings-screen .dialog-backdrop')) return

      const focusable = [...(screenRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter(element => element.getClientRects().length > 0)

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = useCallback((patch: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  /** Provider actions (connect/disconnect/setDefault) persist meow.json
   *  directly via their own IPC; record the result so the debounced auto-save
   *  doesn't immediately re-save a stale draft and the save pill reflects the
   *  real write. */
  const onPersisted = useCallback((result: MeowSettings) => {
    draftRef.current = result
    lastPersistedRef.current = JSON.stringify(result)
    setDraft(result)
    setSaveState('saved')
  }, [])

  return createPortal(
    <section ref={screenRef} className="settings-screen" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-screen-body">
        <div className="settings-body">
          <aside className="settings-sidebar">
            <button ref={backButtonRef} className="btn settings-screen-back" onClick={onClose}>
              <ArrowLeft size={15} aria-hidden="true" />
              Back to app
            </button>
            <nav className="settings-nav">
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={`settings-nav-item ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </aside>
          <div className="settings-content">
            {draft && tab === 'agents' && (
              <AgentsTab
                agents={draft.agents}
                providers={draft.providers}
                subagentModels={draft.subagentModels}
                onChangeAgents={agents => patch({ agents })}
                onChangeSubagentModels={subagentModels => patch({ subagentModels })}
              />
            )}
            {draft && tab === 'permissions' && (
              <PermissionsTab permission={draft.permission} onChange={permission => patch({ permission })} />
            )}
            {draft && tab === 'mcp' && (
              <McpTab
                mcp={draft.mcp}
                status={mcpStatus}
                onChange={mcp => patch({ mcp })}
                onReconnect={async () => {
                  const result = await window.api.reconnectMcp()
                  setMcpStatus(result)
                  return result
                }}
              />
            )}
            {draft && tab === 'providers' && (
              <ProvidersTab
                settings={draft}
                catalog={catalog}
                onChange={patch}
                onPersisted={onPersisted}
                onRefresh={() => void refresh()}
              />
            )}
            {draft && tab === 'context' && (
              <ContextTab
                maxSteps={draft.maxSteps}
                compaction={draft.compaction}
                toolOutput={draft.toolOutput}
                notifications={draft.notifications ?? { needsInput: true, onDone: true }}
                mcpOutput={draft.mcpOutput}
                resolvedContextTokens={resolvedContextTokens}
                onChange={ctx => patch(ctx)}
              />
            )}
            {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
            {tab === 'remote' && <RemoteTab />}
            {tab === 'templates' && <TemplatesTab templates={templates} onChange={onTemplatesChange} />}
            {tab === 'updates' && <UpdatesTab />}
            {tab === 'personalize' && <PersonalizeTab />}
          </div>
        </div>
      </div>
      {saveState !== 'idle' && (
        <div className={`settings-save-pill ${saveState}`} role="status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved ✓'}
          {saveState === 'error' && (saveError || 'Save failed')}
        </div>
      )}
    </section>,
    document.body
  )
}
