import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface DropdownProps {
  trigger: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  menuClassName?: string
  children: ReactNode
}

// Reusable popup dropdown: button trigger + absolutely positioned menu.
// Closes on outside mousedown (containment check) and on Escape.
export default function Dropdown({
  trigger, open, onToggle, onClose, title, menuClassName = '', children
}: DropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className="dropdown-trigger"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        {trigger}
      </button>
      {open && (
        <div className={`dropdown-menu ${menuClassName}`.trim()}>
          {children}
        </div>
      )}
    </div>
  )
}
