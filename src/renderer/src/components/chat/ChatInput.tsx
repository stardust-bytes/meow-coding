import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMode, Command, ImageAttachment } from '@shared/types'
import { parseCommandInput } from './parseCommandInput'

interface Props {
  running: boolean
  mode: AgentMode
  commands: Command[]
  onSubmit(text: string, images: ImageAttachment[]): void
  onStop(): void
}

const MAX_MENU_ITEMS = 12
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 4

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const [menu, setMenu] = useState<{ open: boolean; prefix: string }>({ open: false, prefix: '' })
  const [selectedName, setSelectedName] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])

  // Reads pasted/dropped image files into dataURL attachments, capped at
  // MAX_IMAGES attachments of MAX_IMAGE_SIZE each.
  const addImageFiles = useCallback((files: File[]) => {
    setImages(prev => {
      const next = [...prev]
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        if (file.size > MAX_IMAGE_SIZE) continue
        if (next.length >= MAX_IMAGES) break
        const id = crypto.randomUUID()
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '')
          setImages(cur => cur.map(img =>
            img.id === id ? { ...img, dataUrl } : img
          ))
        }
        next.push({ id, name: file.name || 'paste', mimeType: file.type, dataUrl: '', size: file.size })
        reader.readAsDataURL(file)
      }
      return next
    })
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }, [])

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
  // (no "/") leaves menu {open:false,prefix:''} unchanged — setMenu's bail-out
  // returns the same object reference, so React skips re-rendering entirely.
  // (An earlier version deferred this check to requestAnimationFrame to keep
  // it off the input event, but rAF/cancelAnimationFrame are real scheduling
  // calls, not free — for plain typing that replaced a no-op with two browser
  // API calls per keystroke, making the common case slower for no benefit at
  // this app's command-list size. Plain synchronous check wins here.)
  const syncMenu = useCallback((raw: string) => {
    const { isCommand, prefix } = parseCommandInput(raw)
    setMenu(prev => (prev.open === isCommand && prev.prefix === prefix ? prev : { open: isCommand, prefix }))
    if (isCommand) setSelectedName('')
  }, [])

  const submit = useCallback(() => {
    const text = (fieldRef.current?.value ?? '').trim()
    if ((!text && images.length === 0) || running) return
    if (fieldRef.current) fieldRef.current.value = ''
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    onSubmit(text, images)
    setImages([])
  }, [running, onSubmit, images])

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
        onPaste={e => {
          const files = Array.from(e.clipboardData.items)
            .map(item => item.getAsFile())
            .filter((f): f is File => f !== null)
          if (files.length > 0) {
            e.preventDefault()
            addImageFiles(files)
          }
        }}
        onDrop={e => {
          const files = Array.from(e.dataTransfer.files)
          if (files.length > 0) {
            e.preventDefault()
            addImageFiles(files)
          }
        }}
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
      {images.length > 0 && (
        <div className="chat-input-chips">
          {images.map(img => (
            <span key={img.id} className="chat-image-chip">
              {img.dataUrl
                ? <img src={img.dataUrl} alt={img.name} className="chat-image-thumb" />
                : <span className="chat-image-thumb chat-image-thumb-empty" />}
              <span className="chat-image-name">{img.name}</span>
              <button
                className="chat-image-remove"
                aria-label={`remove ${img.name}`}
                onClick={() => removeImage(img.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          addImageFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <button
        className="chat-input-attach"
        title="attach image"
        aria-label="attach image"
        disabled={running}
        onClick={() => fileInputRef.current?.click()}
      >
        +
      </button>
      <button
        className={`chat-input-send ${running ? 'running' : ''}`}
        onClick={running ? onStop : submit}
      >
        {running ? 'Stop' : 'Send'}
      </button>
    </div>
  )
})
