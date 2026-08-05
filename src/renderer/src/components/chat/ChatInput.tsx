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
  const [value, setValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedName, setSelectedName] = useState('')
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  const isCommandInput = value.startsWith('/') && !value.includes(' ')
  const prefix = isCommandInput ? value.slice(1).toLowerCase() : ''

  const filtered = useMemo(() => {
    if (!isCommandInput) return []
    const list = prefix
      ? commands.filter(c => c.name.toLowerCase().startsWith(prefix))
      : commands
    return list.slice(0, MAX_MENU_ITEMS)
  }, [commands, isCommandInput, prefix])

  const selectedIndex = filtered.findIndex(c => c.name === selectedName)

  // Scroll only when the highlighted item moves, not while typing.
  useEffect(() => {
    if (!menuOpen) return
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedName, menuOpen])

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text || running) return
    setValue('')
    setMenuOpen(false)
    onSubmit(text)
  }, [value, running, onSubmit])

  const applyCommand = useCallback((cmd: Command) => {
    setValue(`/${cmd.name} `)
    setMenuOpen(false)
    setSelectedName('')
    fieldRef.current?.focus()
  }, [])

  // Stable handlers — items pass their own name back.
  const onSelect = useCallback((name: string) => setSelectedName(name), [])
  const onPick = useCallback((name: string) => {
    const cmd = commands.find(c => c.name === name)
    if (cmd) applyCommand(cmd)
  }, [commands, applyCommand])

  const onChange = useCallback((next: string) => {
    setValue(next)
    setSelectedName('')
    setMenuOpen(next.startsWith('/') && !next.includes(' '))
  }, [])

  const move = useCallback((delta: number) => {
    if (filtered.length === 0) return
    const cur = selectedIndex < 0 ? 0 : selectedIndex
    const next = (cur + delta + filtered.length) % filtered.length
    setSelectedName(filtered[next].name)
  }, [filtered, selectedIndex])

  return (
    <div className="chat-input">
      {menuOpen && filtered.length > 0 && (
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
        value={value}
        placeholder="Message Meow...  ( / for commands )"
        rows={2}
        disabled={running}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (menuOpen && filtered.length > 0) {
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
          if (e.key === 'Escape') setMenuOpen(false)
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
