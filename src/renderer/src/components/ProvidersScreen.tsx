import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import type { CatalogProviderSummary, MeowSettings } from '@shared/types'
import ProvidersTab from './settings/ProvidersTab'

interface Props {
  onClose: () => void
}

export default function ProvidersScreen({ onClose }: Props) {
  const [settings, setSettings] = useState<MeowSettings | null>(null)
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [error, setError] = useState('')
  const screenRef = useRef<HTMLElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextSettings, nextCatalog] = await Promise.all([
        window.api.getSettings(),
        window.api.listProviderCatalog()
      ])
      setSettings(nextSettings)
      setCatalog(nextCatalog)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.providers-screen .dialog-backdrop')) onClose()
      if (event.key !== 'Tab' || document.querySelector('.providers-screen .dialog-backdrop')) return

      const focusable = [...(screenRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter(element => element.getClientRects().length > 0)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <section ref={screenRef} className="providers-screen" role="dialog" aria-modal="true" aria-label="Providers">
      <header className="providers-screen-header">
        <button ref={backButtonRef} className="btn providers-screen-back" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to app
        </button>
        <h2>Providers</h2>
      </header>
      <main className="providers-screen-content">
        {settings ? (
          <ProvidersTab
            settings={settings}
            catalog={catalog}
            onChange={patch => setSettings(current => current ? { ...current, ...patch } : current)}
          />
        ) : error ? (
          <p className="settings-error">{error}</p>
        ) : (
          <p className="settings-hint">Loading providers…</p>
        )}
      </main>
    </section>
    , document.body
  )
}
