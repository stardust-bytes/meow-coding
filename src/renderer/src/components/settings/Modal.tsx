import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
  submitLabel?: string
  onSubmit?(): void
  submitDisabled?: boolean
}

export default function Modal({
  title, onClose, children, submitLabel = 'Save', onSubmit, submitDisabled = false
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{title}</h3>
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        {children}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          {onSubmit && (
            <button className="btn primary submit" disabled={submitDisabled} onClick={onSubmit}>
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
