import { useRef, useState } from 'react'
import type { AgentMode, Command } from '@shared/types'

interface Props {
  running: boolean
  mode: AgentMode
  commands: Command[]
  onSubmit(text: string): void
  onStop(): void
}

export default function ChatInput({ running, mode, commands, onSubmit, onStop }: Props) {
  const [value, setValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  const commandPrefix = value.startsWith('/') ? value.split(/\s+/)[0].slice(1) : ''
  const filtered = commandPrefix !== ''
    ? commands.filter(c => c.name.startsWith(commandPrefix))
    : []

  const submit = () => {
    const text = value.trim()
    if (!text || running) return
    setValue('')
    setMenuOpen(false)
    onSubmit(text)
  }

  const applyCommand = (cmd: Command) => {
    setValue(`/${cmd.name} `)
    setMenuOpen(false)
    fieldRef.current?.focus()
  }

  const onChange = (next: string) => {
    setValue(next)
    setSelected(0)
    if (next.startsWith('/')) setMenuOpen(true)
  }

  return (
    <div className="chat-input">
      {menuOpen && filtered.length > 0 && (
        <div className="command-menu">
          {filtered.map((c, i) => (
            <button
              key={c.name}
              className={`command-item ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => applyCommand(c)}
            >
              <span className="command-name">/{c.name}</span>
              <span className="command-desc">{c.description}</span>
            </button>
          ))}
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
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => (s + 1) % filtered.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => (s - 1 + filtered.length) % filtered.length); return }
            if (e.key === 'Tab') { e.preventDefault(); applyCommand(filtered[selected]); return }
            if (e.key === 'Enter') {
              e.preventDefault()
              applyCommand(filtered[selected])
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
}
