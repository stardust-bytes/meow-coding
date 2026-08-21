import { useCallback, useEffect, useState } from 'react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings, Template } from '@shared/types'
import ProvidersTab from './ProvidersTab'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import TemplatesTab from './TemplatesTab'
import UpdatesTab from './UpdatesTab'

type TabId = 'providers' | 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'templates' | 'updates'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'agents', label: 'Agents' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' },
  { id: 'remote', label: 'Remote Control' },
  { id: 'templates', label: 'Templates' },
  { id: 'updates', label: 'Updates' }
]

interface Props {
  onClose: () => void
  projectPath?: string
  templates: Template[]
  onTemplatesChange: (templates: Template[]) => void
}

export default function SettingsDialog({ onClose, projectPath, templates, onTemplatesChange }: Props) {
  const [tab, setTab] = useState<TabId>('providers')
  const [draft, setDraft] = useState<MeowSettings | null>(null)
  const [saved, setSaved] = useState<MeowSettings | null>(null)
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [settings, cat, mcps] = await Promise.all([
        window.api.getSettings(),
        window.api.listProviderCatalog(),
        window.api.getMcpStatus()
      ])
      setDraft(settings)
      setSaved(settings)
      setCatalog(cat)
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

  // Close on Escape only — the backdrop no longer closes on outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuarded()
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

  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-dialog">
        <h3>Settings</h3>
        <button className="dialog-close" aria-label="Close" onClick={closeGuarded}>✕</button>
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
            {draft && tab === 'providers' && (
              <ProvidersTab settings={draft} catalog={catalog} onChange={patch} />
            )}
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
        {status && <div className="settings-status">{status}</div>}
        {error && <div className="settings-error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={closeGuarded}>Cancel</button>
          <button className="btn primary" disabled={!draft || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
