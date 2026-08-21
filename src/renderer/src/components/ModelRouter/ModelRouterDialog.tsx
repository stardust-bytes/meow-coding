import { useEffect, useState } from 'react'
import AccountsTab from './AccountsTab'
import GatewayTab from './GatewayTab'
import QuotaTab from './QuotaTab'
import LogsTab from './LogsTab'

type TabId = 'accounts' | 'gateway' | 'quota' | 'logs'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'quota', label: 'Quota' },
  { id: 'logs', label: 'Logs' }
]

export default function ModelRouterDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('accounts')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop">
      <div className="dialog model-router-dialog">
        <h3>Model Router</h3>
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="mr-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`mr-nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mr-body">
          {tab === 'accounts' && <AccountsTab />}
          {tab === 'gateway' && <GatewayTab />}
          {tab === 'quota' && <QuotaTab />}
          {tab === 'logs' && <LogsTab />}
        </div>
      </div>
    </div>
  )
}
