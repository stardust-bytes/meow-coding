import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMode, Command } from '@shared/types'
import { parseCommandInput } from './parseCommandInput'

interface Props {
  running: boolean
  mode: AgentMode
  commands: Command[]
  onSubmit(text: string): void
  onStop(): void
}

const MAX_MENU_ITEMS = 12

// Item renders its own closures against `command.name`, so the parent can pass
// stable callbacks and React.memo actually skips re-rendering unchanged items.
const CommandMenuItem = memo(function CommandMenuItem({
  command, selected, onSelect, onPick, itemRef
}: {
  command: Command
  selected: boolean
  onSelect: (name: string) => void
  onPick: (name: string) => void
  itemRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={itemRef}
      className={`command-item ${selected ? 'selected' : ''}`}
      onMouseEnter={() => onSelect(command.name)}
      onClick={() => onPick(command.name)}
    >
      <span className="command-name">/{command.name}</span>
      <span className="command-desc">{command.description}</span>
    </button>
  )
})

export default memo(function ChatInput({ running, mode, commands, onSubmit, onStop }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const [menu, setMenu] = useState<{ open: boolean; prefix: string }>({ open: false, prefix: '' })
  const [selectedName, setSelectedName] = useState('')

  const filtered = useMemo(() => {
    if (!menu.open) return []
    const list = menu.prefix
      ? commands.filter(c => c.name.toLowerCase().startsWith(menu.prefix))
      : commands
    return list.slice(0, MAX_MENU_ITEMS)
  }, [commands, menu])

  const selectedIndex = filtered.findIndex(c => c.name === selectedName)

  // Scroll only when the highlighted item moves, not while typing.
  useEffect(() => {
    if (!menu.open) return
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedName, menu.open])

  // Keep the menu state in sync with the raw textarea value. The textarea
  // itself is uncontrolled, so the browser paints every keystroke immediately;
  // the (still cheap, but non-zero once command lists grow) menu-open/prefix
  // check runs on the next animation frame instead of inside the input event,
  // so it never competes with that paint. Plain typing still ends up with
  // menu {open:false,prefix:''} unchanged, so React does not re-render at all.
  const rafRef = useRef<number | null>(null)
  const cancelPendingSync = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])
  useEffect(() => cancelPendingSync, [cancelPendingSync])

  const applyMenuFromValue = useCallback((raw: string) => {
    const { isCommand, prefix } = parseCommandInput(raw)
    setMenu(prev => (prev.open === isCommand && prev.prefix === prefix ? prev : { open: isCommand, prefix }))
    if (isCommand) setSelectedName('')
    return { isCommand, prefix }
  }, [])

  const syncMenu = useCallback((raw: string) => {
    cancelPendingSync()
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      applyMenuFromValue(raw)
    })
  }, [cancelPendingSync, applyMenuFromValue])

  // Keys that act on the menu (select/navigate/submit) need the menu state to
  // be current *this tick*, not next frame. If a sync is still pending — only
  // possible when a key lands inside the same ~16ms as the previous input
  // event, never in normal human typing — apply it immediately and use the
  // freshly computed result instead of the (one-frame-stale) render state.
  const flushPendingSync = useCallback(() => {
    if (rafRef.current === null) return null
    cancelPendingSync()
    return applyMenuFromValue(fieldRef.current?.value ?? '')
  }, [cancelPendingSync, applyMenuFromValue])

  const submit = useCallback(() => {
    const text = (fieldRef.current?.value ?? '').trim()
    if (!text || running) return
    cancelPendingSync()
    if (fieldRef.current) fieldRef.current.value = ''
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    onSubmit(text)
  }, [running, onSubmit, cancelPendingSync])

  const applyCommand = useCallback((cmd: Command) => {
    cancelPendingSync()
    if (fieldRef.current) fieldRef.current.value = `/${cmd.name} `
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    fieldRef.current?.focus()
  }, [cancelPendingSync])

  // Stable handlers — items pass their own name back.
  const onSelect = useCallback((name: string) => setSelectedName(name), [])
  const onPick = useCallback((name: string) => {
    const cmd = commands.find(c => c.name === name)
    if (cmd) applyCommand(cmd)
  }, [commands, applyCommand])

  return (
    <div className="chat-input">
      {menu.open && filtered.length > 0 && (
        <div className="command-menu">
          {filtered.map(c => (
            <CommandMenuItem
              key={c.name}
              command={c}
              selected={c.name === selectedName}
              itemRef={c.name === selectedName ? el => { selectedRef.current = el } : undefined}
              onSelect={onSelect}
              onPick={onPick}
            />
          ))}
          {commands.length > MAX_MENU_ITEMS && (
            <div className="command-more">… more commands</div>
          )}
        </div>
      )}
      <textarea
        ref={fieldRef}
        className={`chat-input-field mode-${mode}`}
        placeholder="Message Meow...  ( / for commands )"
        rows={2}
        disabled={running}
        onInput={e => syncMenu((e.target as HTMLTextAreaElement).value)}
        onKeyDown={e => {
          const flushed = flushPendingSync()
          const open = flushed ? flushed.isCommand : menu.open
          const currentFiltered = flushed
            ? (flushed.prefix
                ? commands.filter(c => c.name.toLowerCase().startsWith(flushed.prefix))
                : commands
              ).slice(0, MAX_MENU_ITEMS)
            : filtered
          const currentIndex = flushed
            ? currentFiltered.findIndex(c => c.name === selectedName)
            : selectedIndex

          if (open && currentFiltered.length > 0) {
            const selectDelta = (delta: number) => {
              const cur = currentIndex < 0 ? 0 : currentIndex
              const next = (cur + delta + currentFiltered.length) % currentFiltered.length
              setSelectedName(currentFiltered[next].name)
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); selectDelta(1); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); selectDelta(-1); return }
            if (e.key === 'Tab') { e.preventDefault(); onPick(currentFiltered[currentIndex < 0 ? 0 : currentIndex].name); return }
            if (e.key === 'Enter') {
              e.preventDefault()
              onPick(currentFiltered[currentIndex < 0 ? 0 : currentIndex].name)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') {
            cancelPendingSync()
            setMenu(prev => (prev.open ? { open: false, prefix: '' } : prev))
          }
        }}
      />
      <button
        className={`chat-input-send ${running ? 'running' : ''}`}
        onClick={running ? onStop : submit}
      >
        {running ? 'Stop' : 'Send'}
      </button>
    </div>
  )
})
