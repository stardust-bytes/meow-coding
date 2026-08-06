import { useCallback, useEffect, useState } from 'react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings } from '@shared/types'
import ProvidersTab from './ProvidersTab'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'

type TabId = 'providers' | 'agents' | 'permissions' | 'mcp' | 'context' | 'commands'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'agents', label: 'Agents' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' }
]

interface Props {
  onClose: () => void
  projectPath?: string
}

export default function SettingsDialog({ onClose, projectPath }: Props) {
  const [tab, setTab] = useState<TabId>('providers')
  const [draft, setDraft] = useState<MeowSettings | null>(null)
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
      setCatalog(cat)
      setMcpStatus(mcps)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Close on Escape only — the backdrop no longer closes on outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = useCallback((patch: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    setStatus('')
    setError('')
    try {
      const saved = await window.api.saveSettings(draft)
      setDraft(saved)
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
              <ProvidersTab settings={draft} catalog={catalog} onChange={patch} onRefresh={refresh} />
            )}
            {draft && tab === 'agents' && (
              <AgentsTab agents={draft.agents} onChange={agents => patch({ agents })} />
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
          </div>
        </div>
        {status && <div className="settings-status">{status}</div>}
        {error && <div className="settings-error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!draft || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
