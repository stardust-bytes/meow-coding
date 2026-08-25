# Settings Fullscreen Redesign — implementation plan

**Date:** 2026-08-20
**Spec:** `docs/superpowers/specs/2026-08-20-settings-fullscreen-redesign-design.md`
**Scope:** `SettingsDialog.tsx` + `styles.css` + minor `ProvidersTab` wiring. No IPC changes.

## Goal

Turn the Settings screen into a full page: no header/footer, back button pinned
at the top of a 268px settings sidebar, content fills full height and scrolls,
everything auto-saves (debounced 500ms) with a transient status pill.

## File structure

- `src/renderer/src/components/settings/SettingsDialog.tsx` — all state/layout
  changes; removes `saved`/dirty-check/footer; adds debounced auto-save + pill.
- `src/renderer/src/styles.css` — `.settings-sidebar` (268px), pinned back
  button, scrollable nav, save pill; remove header/footer rules.
- `src/renderer/src/components/settings/ProvidersTab.tsx` — no change needed
  (its `onChange({ providers, defaultProvider })` patches already feed the
  dialog's `patch`; `setDefault`'s immediate `saveSettings` is now redundant
  but harmless — auto-save converges to the same state).

## Task 1 — Rewrite `SettingsDialog.tsx`

File: `src/renderer/src/components/settings/SettingsDialog.tsx`

### Remove
- `saved` state, `isDirty`, `closeGuarded`, `patchProviders`, `save()`,
  `saving`/`status`/`error` footer states.
- The `<header className="settings-screen-header">` and
  `<footer className="settings-screen-footer">` JSX blocks.

### Add (state)
```tsx
const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
const [saveError, setSaveError] = useState('')
const saveTimerRef = useRef<number | null>(null)
const savingRef = useRef(false)
const pendingRef = useRef(false)
const draftRef = useRef<MeowSettings | null>(null)
const lastPersistedRef = useRef('')
```

### Keep
- `draft`, `mcpStatus`, `catalog`, `tab`, `screenRef`, `backButtonRef`,
  `previousFocusRef`, `refresh` (add `lastPersistedRef.current = JSON.stringify(settings)`
  after fetching so initial load doesn't trigger a save), `patch`, focus trap,
  Escape→close (now `onClose()` directly), `aria-hidden` handling.

### Auto-save (debounced, serialized)
```tsx
useEffect(() => { draftRef.current = draft }, [draft])

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
    draftRef.current = result
    lastPersistedRef.current = JSON.stringify(result)
    setDraft(result)
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

// flush pending save on unmount (fire-and-forget)
useEffect(() => () => {
  if (saveTimerRef.current) {
    window.clearTimeout(saveTimerRef.current)
    const current = draftRef.current
    if (current && JSON.stringify(current) !== lastPersistedRef.current) {
      void window.api.saveSettings(current)
    }
  }
}, [])

// auto-hide pill after 2s
useEffect(() => {
  if (saveState !== 'saved' && saveState !== 'error') return
  const id = window.setTimeout(() => setSaveState('idle'), 2000)
  return () => window.clearTimeout(id)
}, [saveState])
```

### JSX
```tsx
return createPortal(
  <section ref={screenRef} className="settings-screen" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="settings-screen-body">
      <div className="settings-body">
        <aside className="settings-sidebar">
          <button ref={backButtonRef} className="settings-screen-back" onClick={onClose}>
            <ArrowLeft size={15} aria-hidden="true" />
            Back
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
          {/* unchanged tab rendering; ProvidersTab becomes:
              settings={draft} onChange={patch} */}
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
```

- `ProvidersTab` props: `settings={draft}` `onChange={patch}` (drop `saved`).
- Focus trap effect deps: change `[closeGuarded]` → `[onClose]`.
- Escape handler: `if (e.key === 'Escape' && !document.querySelector('.settings-screen .dialog-backdrop')) onClose()`.

## Task 2 — CSS in `styles.css`

File: `src/renderer/src/styles.css` (settings section ~lines 937–987)

- Remove `.settings-screen-header` / `.settings-screen-header h2` /
  `.settings-screen-back` (old) / `.settings-screen-footer` /
  `.settings-screen-status` rules.
- Add:
```css
.settings-sidebar {
  flex: 0 0 268px;            /* = .sidebar width */
  display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid var(--hairline);
  background: var(--bg-panel);
}
.settings-screen-back {
  flex: 0 0 auto; width: 100%;
  display: flex; align-items: center; gap: 8px;
  min-height: 44px; padding: 0 14px;
  background: transparent; border: none;
  border-bottom: 1px solid var(--hairline);
  color: var(--text); font-size: var(--fs-md); font-weight: var(--fw-medium);
  cursor: pointer; text-align: left; border-radius: 0;
}
.settings-screen-back:hover { color: var(--text-strong); background: var(--bg-hover); }
```
- `.settings-nav`: `flex: 1; overflow-y: auto; border-right: none;` (keep gap,
  padding — replace the `flex: 0 0 150px; border-right: 1px solid...` and the
  `.settings-screen .settings-nav { padding: 0.25rem; }` override).
- `.settings-content` unchanged (flex:1, overflow-y auto) — it already scrolls.
- Add save pill:
```css
.settings-save-pill {
  position: fixed; right: 18px; bottom: 18px; z-index: 110;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: var(--radius-lg);
  background: var(--bg-raised); border: 1px solid var(--hairline);
  box-shadow: var(--shadow-2);
  font-size: var(--fs-sm); color: var(--text-dim);
}
.settings-save-pill.saved { color: var(--green); border-color: rgba(74, 222, 159, 0.35); }
.settings-save-pill.error { color: var(--red); border-color: rgba(255, 95, 86, 0.35); }
```
- Keep `.settings-status`/`.settings-error` rules (tabs still use them inline).

## Task 3 — Verify

- `npm run typecheck`
- `npm test`
- Manual smoke (optional): open settings, edit a field, confirm pill shows
  "Saved ✓" ~500ms later, close without confirm dialog.

## Acceptance criteria

1. No header/footer on Settings; back button (← Back) pinned top of sidebar.
2. Sidebar 268px; nav scrolls; content fills height and scrolls.
3. Auto-save within ~500ms; "Saved ✓" pill; no Save button; no confirm on close.
4. typecheck + tests pass.
