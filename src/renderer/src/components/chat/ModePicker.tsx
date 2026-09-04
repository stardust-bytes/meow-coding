import { useState } from 'react'
import type { AgentMode } from '@shared/types'
import Dropdown from './Dropdown'

interface ModePickerProps {
  value: AgentMode
  onChange: (m: AgentMode) => void
}

const MODES: { value: AgentMode; label: string; className: string }[] = [
  { value: 'build', label: 'Build', className: 'mode-build' },
  { value: 'plan', label: 'Plan', className: 'mode-plan' }
]

export default function ModePicker({ value, onChange }: ModePickerProps) {
  const [open, setOpen] = useState(false)
  const active = MODES.find(m => m.value === value) ?? MODES[0]

  return (
    <Dropdown
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      title="Mode"
      ariaLabel="Mode"
      menuClassName="mode-menu"
      trigger={
        <>
          <span className={`mode-label mode-${active.value}`}>{active.label}</span>
          <span className="mode-caret">▾</span>
        </>
      }
    >
      <div className="mode-list">
        {MODES.map(m => (
          <button
            key={m.value}
            className={`mode-item ${m.className} ${m.value === value ? 'active' : ''}`}
            onClick={() => { onChange(m.value); setOpen(false) }}
          >
            <span className="mode-check">{m.value === value ? '✓' : ''}</span>
            {m.label}
          </button>
        ))}
      </div>
    </Dropdown>
  )
}
