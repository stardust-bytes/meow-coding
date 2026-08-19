# Variant Picker: Custom Dropdown (shared base) — Design

Date: 2026-08-19
Status: Approved (user), pending spec review

## Problem

The variant `<select>` next to the model picker in the chat panel renders the
browser/OS default `<select>` element (native arrow + native popup). The model
picker next to it uses a fully custom dropdown (button trigger + popup menu).
The variant select should use a custom dropdown that matches the app's look,
and ideally be built on a reusable base component.

## Chosen approach

Option 2 (from brainstorm):

1. Create a reusable base `Dropdown` component (trigger + popup + outside-click
   + Escape close). Do **not** refactor `ModelPicker` in this change.
2. Create a new `VariantPicker` component built on the base.
3. Swap the `<select className="input chat-variant-select">` in `ChatPanel.tsx`
   for `<VariantPicker>`, keeping all variant state/refresh logic untouched.
4. Add shared CSS classes (`.dropdown*`, `.variant*`) copied from `.model*`
   styling; remove the now-unused `.chat-variant-select` rule.

## Files

| File | Change |
|---|---|
| `src/renderer/src/components/chat/Dropdown.tsx` | **New.** Base dropdown. |
| `src/renderer/src/components/chat/VariantPicker.tsx` | **New.** Variant picker on the base. |
| `src/renderer/src/components/chat/ChatPanel.tsx` | Replace `<select>` block with `<VariantPicker>`. |
| `src/renderer/src/styles.css` | Add `.dropdown*` / `.variant*` classes; remove `.chat-variant-select`. |

## Dropdown base component API

```tsx
interface DropdownProps {
  trigger: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  menuClassName?: string
  children: ReactNode
}
```

Responsibilities:
- Render `<button aria-haspopup="listbox" aria-expanded={open}>` containing
  `trigger`, styled with the shared `.dropdown-trigger` class.
- Render `{open && <div className={...}>{children}</div>}` popup (`.dropdown-menu`).
- Close on outside `mousedown` (root ref containment check) and on `Escape`.

## VariantPicker component API

```tsx
interface VariantPickerProps {
  variants: string[]
  value: string          // '' = Default
  onChange: (v: string) => void
}
```

Behavior:
- Trigger label: `value || 'Default'` + caret `▾`.
- Menu opens upward, right-aligned (same as ModelPicker, both live on the
  header).
- Menu items: `Default` (value `''`) followed by `variants` in order.
- Active item (current `value`) highlighted + ✓ mark.
- No search box (variant lists are short).

## ChatPanel wiring (unchanged behavior)

- `currentVariant`, `availableVariants`, `refreshVariants`, the
  `meow:model-changed` listener, and the `onVariantChange` callback all stay as
  they are today. Only the rendered element changes:
  `onChange={v => { setCurrentVariant(v); onVariantChange?.(v === '' ? undefined : v) }}`.

## CSS

Add (copied from `.model-*` styles, renamed):

- `.dropdown` — `position: relative; display: inline-flex;`
- `.dropdown-trigger` — same as `.model-trigger`
- `.dropdown-trigger:hover` — same as `.model-trigger:hover`
- `.dropdown-menu` — shared popup chrome from `.model-menu` (absolute,
  bottom: calc(100% + 4px), right: 0, z-index 40, bg/border/radius/shadow,
  flex column). No fixed width.
- `.variant-menu` — width auto, `min-width: 140px` (variant lists are short;
  unlike `.model-menu`'s fixed 300px).
- `.variant-label`, `.variant-caret`, `.variant-list`, `.variant-item`,
  `.variant-item.active` — copied from `.model-label`, `.model-caret`,
  `.model-list`, `.model-item`

Remove `.chat-variant-select` rule.

## Out of scope

- Refactoring `ModelPicker` onto the base (future work).
- Adding search to the variant list.
- Changing variant selection behavior/IPC.
