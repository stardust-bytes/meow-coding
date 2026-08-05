import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMode, Command } from '@shared/types'

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

  // Keep the menu state in sync with the raw textarea value. Typing plain text
  // (no "/") leaves menu {open:false,prefix:''} unchanged, so React does not
  // re-render on ordinary keystrokes — the textarea itself is uncontrolled.
  const syncMenu = useCallback((raw: string) => {
    const isCmd = raw.startsWith('/') && !raw.includes(' ')
    const prefix = isCmd ? raw.slice(1).toLowerCase() : ''
    setMenu(prev => (prev.open === isCmd && prev.prefix === prefix ? prev : { open: isCmd, prefix }))
    if (isCmd) setSelectedName('')
  }, [])

  const submit = useCallback(() => {
    const text = (fieldRef.current?.value ?? '').trim()
    if (!text || running) return
    if (fieldRef.current) fieldRef.current.value = ''
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    onSubmit(text)
  }, [running, onSubmit])

  const applyCommand = useCallback((cmd: Command) => {
    if (fieldRef.current) fieldRef.current.value = `/${cmd.name} `
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    fieldRef.current?.focus()
  }, [])

  // Stable handlers — items pass their own name back.
  const onSelect = useCallback((name: string) => setSelectedName(name), [])
  const onPick = useCallback((name: string) => {
    const cmd = commands.find(c => c.name === name)
    if (cmd) applyCommand(cmd)
  }, [commands, applyCommand])

  const move = useCallback((delta: number) => {
    if (filtered.length === 0) return
    const cur = selectedIndex < 0 ? 0 : selectedIndex
    const next = (cur + delta + filtered.length) % filtered.length
    setSelectedName(filtered[next].name)
  }, [filtered, selectedIndex])

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
          if (menu.open && filtered.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return }
            if (e.key === 'Tab') { e.preventDefault(); onPick(filtered[selectedIndex < 0 ? 0 : selectedIndex].name); return }
            if (e.key === 'Enter') {
              e.preventDefault()
              onPick(filtered[selectedIndex < 0 ? 0 : selectedIndex].name)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') setMenu(prev => (prev.open ? { open: false, prefix: '' } : prev))
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
