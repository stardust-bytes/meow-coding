import { useState } from 'react'
import Dropdown from './Dropdown'

interface VariantPickerProps {
  variants: string[]
  value: string          // '' = Default
  onChange: (v: string) => void
}

export default function VariantPicker({ variants, value, onChange }: VariantPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dropdown
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      title="Model effort"
      menuClassName="variant-menu"
      trigger={
        <>
          <span className="variant-label">{value || 'Default'}</span>
          <span className="variant-caret">▾</span>
        </>
      }
    >
      <div className="variant-list">
        <button
          className={`variant-item ${value === '' ? 'active' : ''}`}
          onClick={() => { onChange(''); setOpen(false) }}
        >
          <span className="variant-check">{value === '' ? '✓' : ''}</span>
          Default
        </button>
        {variants.map(v => (
          <button
            key={v}
            className={`variant-item ${value === v ? 'active' : ''}`}
            onClick={() => { onChange(v); setOpen(false) }}
          >
            <span className="variant-check">{value === v ? '✓' : ''}</span>
            {v}
          </button>
        ))}
      </div>
    </Dropdown>
  )
}
