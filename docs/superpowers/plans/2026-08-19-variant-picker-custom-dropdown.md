# Variant Picker Custom Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `<select>` used for the agent's model variant (next to the model picker) with a custom dropdown built on a reusable base `Dropdown` component, styled to match the model picker.

**Spec:** `docs/superpowers/specs/2026-08-19-variant-picker-custom-dropdown-design.md`

**Tech Stack:** React 19 + TypeScript (strict), plain CSS with CSS variables, Vitest.

**Out of scope:** Refactoring `ModelPicker` onto the base; search box in variant menu; changing variant behavior/IPC.

---

## Task 1 — Create base `Dropdown.tsx`

New file: `src/renderer/src/components/chat/Dropdown.tsx`

```tsx
import { useCallback, useEffect, useRef } from 'react'
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

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

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
        <div className={`dropdown-menu ${menuClassName}`.trim()} onMouseDown={stopProp}>
          {children}
        </div>
      )}
    </div>
  )
}
```

Notes:
- Follows the ModelPicker outside-click pattern (mousedown containment check).
- Menu stops propagation of `mousedown` so clicking inside never closes the dropdown (selection happens via item `onClick`, which also calls `onClose`).
- `menuClassName` appended to the shared `.dropdown-menu` so VariantPicker can add `.variant-menu`.

**Test:** `npm run typecheck` passes after Task 2 (component referenced).

## Task 2 — Create `VariantPicker.tsx`

New file: `src/renderer/src/components/chat/VariantPicker.tsx`

```tsx
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
          {value === '' && <span className="variant-check">✓</span>}
          Default
        </button>
        {variants.map(v => (
          <button
            key={v}
            className={`variant-item ${value === v ? 'active' : ''}`}
            onClick={() => { onChange(v); setOpen(false) }}
          >
            {value === v && <span className="variant-check">✓</span>}
            {v}
          </button>
        ))}
      </div>
    </Dropdown>
  )
}
```

**Test:** `npm run typecheck` passes.

## Task 3 — Wire into `ChatPanel.tsx`

- Add import: `import VariantPicker from './VariantPicker'` (alphabetical, after `SessionBar`/`ModelPicker` block — place after `ModelPicker` import).
- Replace the `<select className="input chat-variant-select">…</select>` block (around line 912) with:

```tsx
<VariantPicker
  variants={availableVariants}
  value={currentVariant}
  onChange={v => {
    setCurrentVariant(v)
    onVariantChange?.(v === '' ? undefined : v)
  }}
/>
```

- Keep the surrounding conditional `{availableVariants.length > 0 && (…)}` and the `aria-label` intent (the trigger `title="Model effort"` now carries it).
- Do NOT touch `currentVariant`/`availableVariants`/`refreshVariants`/`onVariantChange`/listeners.

**Test:** `npm run typecheck` passes.

## Task 4 — CSS in `styles.css`

In the chat mode section (around the `.model-*` rules, ~line 1037):

- Delete: `.chat-variant-select { width: auto; padding: 2px 6px; font-size: var(--fs-base); }`
- Add after the `.model-*` block (or before `.chat-mode-hint`):

```css
.dropdown { position: relative; display: inline-flex; }
.dropdown-trigger {
  display: inline-flex; align-items: center; gap: 6px; max-width: 220px;
  background: var(--bg-input); border: 1px solid var(--hairline); color: #fff;
  font-size: var(--fs-base); font-family: var(--font-mono); cursor: pointer; padding: 3px 9px;
  border-radius: var(--radius);
  transition: border-color 120ms ease, background 120ms ease;
}
.dropdown-trigger:hover { background: var(--bg-input-hover); border-color: var(--accent-border); color: #fff; }
.dropdown-menu {
  position: absolute; bottom: calc(100% + 4px); right: 0; z-index: 40;
  background: var(--bg-raised); border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-3);
  padding: 4px; display: flex; flex-direction: column; gap: 2px;
}
.variant-menu { min-width: 140px; }
.variant-list { display: flex; flex-direction: column; gap: 2px; }
.variant-item {
  text-align: left; display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: transparent; border: none;
  color: var(--text); cursor: pointer; font-size: var(--fs-base); font-family: var(--font-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
}
.variant-item:hover { background: var(--bg-hover); }
.variant-item.active { background: var(--bg-active); color: var(--accent); border-left-color: var(--accent); }
.variant-check { color: var(--accent); flex: 0 0 auto; }
.variant-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.variant-caret { color: var(--text-dim); font-size: var(--fs-sm); }
```

Notes:
- `.dropdown-menu` is the `.model-menu` chrome minus the fixed `width: 300px` and `max-height: 340px` (variant menu sizes itself; `.variant-menu` sets `min-width`).
- `.variant-list` mirrors `.model-list` minus `max-height`/scroll (variant lists are short).

**Test:** `npm run typecheck` + visual check in dev (`npm run dev`): dropdown opens upward/right-aligned, Default + variants listed, active highlighted with ✓, closes on outside click / Escape, model picker unaffected.

## Task 5 — Verify & commit

- `npm run typecheck` passes.
- `npm test` passes.
- If e2e is affected (it isn't — no IPC/agent behavior change): `npm run build && npm run e2e`.
- Commit with message: `feat(chat): custom variant picker dropdown`.
