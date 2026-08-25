import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import type { McpServerStatus, MeowSettings, Template } from '@shared/types'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import TemplatesTab from './TemplatesTab'
import UpdatesTab from './UpdatesTab'

type TabId = 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'templates' | 'updates'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' },
  { id: 'updates', label: 'Updates' }
]

interface Props {
  onClose: () => void
  projectPath?: string
  templates: Template[]
  onTemplatesChange: (templates: Template[]) => void
}

export default function SettingsDialog({ onClose, projectPath, templates, onTemplatesChange }: Props) {
  const [tab, setTab] = useState<TabId>('agents')
  const [draft, setDraft] = useState<MeowSettings | null>(null)
  const [saved, setSaved] = useState<MeowSettings | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const screenRef = useRef<HTMLElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [settings, mcps] = await Promise.all([
        window.api.getSettings(),
        window.api.getMcpStatus()
      ])
      setDraft(settings)
      setSaved(settings)
      setMcpStatus(mcps)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isDirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)

  // Closing with unsaved changes (Escape, Cancel) would otherwise discard
  // them silently — nothing auto-saves until the Save button is clicked.
  const closeGuarded = useCallback(() => {
    if (isDirty && !window.confirm('Discard unsaved settings changes?')) return
    onClose()
  }, [isDirty, onClose])

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
      if (e.key === 'Escape' && !document.querySelector('.settings-screen .dialog-backdrop')) closeGuarded()
      if (e.key !== 'Tab' || document.querySelector('.settings-screen .dialog-backdrop')) return

      const focusable = [...(screenRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter(element => element.getClientRects().length > 0)
      if (focusable.length === 0) return

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
  }, [closeGuarded])

  const patch = useCallback((patch: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    setStatus('')
    setError('')
    try {
      const result = await window.api.saveSettings(draft)
      setDraft(result)
      setSaved(result)
      setMcpStatus(await window.api.getMcpStatus())
      setStatus('Settings saved.')
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <section ref={screenRef} className="settings-screen" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="settings-screen-header">
        <button ref={backButtonRef} className="btn settings-screen-back" onClick={closeGuarded}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to app
        </button>
        <h2>Settings</h2>
      </header>
      <div className="settings-screen-body">
        <div className="settings-body">
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
              />
            )}
            {draft && tab === 'context' && (
              <ContextTab
                maxContextTokens={draft.maxContextTokens}
                maxSteps={draft.maxSteps}
                compaction={draft.compaction}
                toolOutput={draft.toolOutput}
                notifications={draft.notifications ?? { needsInput: true, onDone: true }}
                onChange={ctx => patch(ctx)}
              />
            )}
            {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
            {tab === 'remote' && <RemoteTab />}
            {tab === 'templates' && <TemplatesTab templates={templates} onChange={onTemplatesChange} />}
            {tab === 'updates' && <UpdatesTab />}
          </div>
        </div>
      </div>
      <footer className="settings-screen-footer">
        <div className="settings-screen-status">
          {status && <div className="settings-status">{status}</div>}
          {error && <div className="settings-error">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={closeGuarded}>Cancel</button>
          <button className="btn primary" disabled={!draft || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </footer>
    </section>,
    document.body
  )
}
