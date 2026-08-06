import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMode, Command, FileSuggestion, ImageAttachment } from '@shared/types'
import { parseCommandInput } from './parseCommandInput'

interface Props {
  agentId: string
  running: boolean
  mode: AgentMode
  commands: Command[]
  editTarget?: { id: string; text: string } | null
  onSubmit(text: string, images: ImageAttachment[]): void
  onEditSubmit?(id: string, text: string): void
  onEditCancel?(): void
  onStop(): void
}

const MAX_MENU_ITEMS = 12
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 4
const MENTION_DEBOUNCE_MS = 150
// Trailing @mention being typed: "@prefix" after start or whitespace.
const MENTION_RE = /(?:^|\s)@([\w./\\-]*)$/

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

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9.5 4.5 5 9a2.1 2.1 0 0 0 3 3l4.6-4.6a3.7 3.7 0 0 0-5.2-5.2L3.2 6.6a5.3 5.3 0 0 0 7.5 7.5l3.8-3.8" />
    </svg>
  )
}

export default memo(function ChatInput({
  agentId, running, mode, commands, editTarget, onSubmit, onEditSubmit, onEditCancel, onStop
}: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const fileSelectedRef = useRef<HTMLButtonElement | null>(null)
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menu, setMenu] = useState<{ open: boolean; prefix: string }>({ open: false, prefix: '' })
  const [selectedName, setSelectedName] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [mentions, setMentions] = useState<string[]>([])
  const [fileMenu, setFileMenu] = useState<{ open: boolean; items: FileSuggestion[]; selected: number }>({
    open: false, items: [], selected: 0
  })

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
  const syncMenu = useCallback((raw: string) => {
    const { isCommand, prefix } = parseCommandInput(raw)
    setMenu(prev => (prev.open === isCommand && prev.prefix === prefix ? prev : { open: isCommand, prefix }))
    if (isCommand) setSelectedName('')
  }, [])

  const closeFileMenu = useCallback(() => {
    setFileMenu(prev => (prev.open ? { open: false, items: [], selected: 0 } : prev))
  }, [])

  // Detects a trailing "@prefix" and fetches suggestions with a debounce so a
  // burst of keystrokes issues at most one IPC round-trip per 150ms.
  const syncMentions = useCallback((raw: string) => {
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current)
    const m = MENTION_RE.exec(raw)
    if (!m) {
      closeFileMenu()
      return
    }
    const prefix = m[1]
    mentionDebounceRef.current = setTimeout(() => {
      void window.api.suggestFiles(agentId, prefix).then(items => {
        setFileMenu(prev => (prev.open || items.length > 0
          ? { open: items.length > 0, items, selected: 0 }
          : prev))
      })
    }, MENTION_DEBOUNCE_MS)
  }, [agentId, closeFileMenu])

  const onInput = useCallback((raw: string) => {
    syncMenu(raw)
    syncMentions(raw)
  }, [syncMenu, syncMentions])

  useEffect(() => () => {
    if (mentionDebounceRef.current) clearTimeout(mentionDebounceRef.current)
  }, [])

  const pickFile = useCallback((item: FileSuggestion) => {
    const field = fieldRef.current
    if (!field) return
    const raw = field.value
    const m = MENTION_RE.exec(raw)
    if (!m) return
    const atIndex = m.index + m[0].indexOf('@')
    const caret = field.selectionStart ?? raw.length
    const next = raw.slice(0, atIndex) + `@${item.path} ` + raw.slice(caret)
    field.value = next
    field.focus()
    const pos = atIndex + item.path.length + 2
    field.setSelectionRange(pos, pos)
    closeFileMenu()
    syncMenu(next)
    syncMentions(next)
    setMentions(prev => (prev.includes(item.path) ? prev : [...prev, item.path]))
  }, [closeFileMenu, syncMenu, syncMentions])

  const removeMention = useCallback((path: string) => {
    const field = fieldRef.current
    if (field) {
      field.value = field.value.replace(new RegExp(`@${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`), '')
    }
    setMentions(prev => prev.filter(p => p !== path))
    closeFileMenu()
  }, [closeFileMenu])

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

  const submit = useCallback(() => {
    const text = (fieldRef.current?.value ?? '').trim()
    if (!text) return
    if (fieldRef.current) fieldRef.current.value = ''
    setMenu({ open: false, prefix: '' })
    setSelectedName('')
    setMentions([])
    closeFileMenu()
    if (editTarget) onEditSubmit?.(editTarget.id, text)
    else onSubmit(text, images)
    setImages([])
    onEditCancel?.()
  }, [editTarget, onEditSubmit, onEditCancel, onSubmit, images, closeFileMenu])

  // Load the queued message being edited into the textarea.
  useEffect(() => {
    if (!editTarget) return
    if (fieldRef.current) {
      fieldRef.current.value = editTarget.text
      fieldRef.current.focus()
    }
  }, [editTarget])

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

  const moveFile = useCallback((delta: number) => {
    setFileMenu(prev => {
      if (!prev.open || prev.items.length === 0) return prev
      const next = (prev.selected + delta + prev.items.length) % prev.items.length
      return { ...prev, selected: next }
    })
  }, [])

  // Scroll the highlighted file item into view only when the selection moves.
  useEffect(() => {
    if (fileMenu.open) fileSelectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [fileMenu.open, fileMenu.selected])

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
      {fileMenu.open && fileMenu.items.length > 0 && (
        <div className="command-menu file-menu">
          {fileMenu.items.map((item, i) => (
            <button
              key={item.path}
              ref={i === fileMenu.selected ? el => { fileSelectedRef.current = el } : undefined}
              className={`command-item ${i === fileMenu.selected ? 'selected' : ''}`}
              onMouseEnter={() => setFileMenu(prev => ({ ...prev, selected: i }))}
              onClick={() => pickFile(item)}
            >
              <span className="command-name">{item.isDirectory ? '📁' : '📄'} {item.name}</span>
              <span className="command-desc">{item.path}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-main">
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
        {mentions.length > 0 && (
          <div className="chat-input-chips">
            {mentions.map(path => (
              <span key={path} className="chat-mention-chip">
                <span className="chat-mention-name">@{path}</span>
                <button
                  className="chat-image-remove"
                  aria-label={`remove @${path}`}
                  onClick={() => removeMention(path)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={fieldRef}
          className={`chat-input-field mode-${mode}`}
          placeholder="Message Meow...  ( / for commands )"
          rows={2}
          onInput={e => onInput((e.target as HTMLTextAreaElement).value)}
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
            if (fileMenu.open && fileMenu.items.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); moveFile(1); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); moveFile(-1); return }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault()
                pickFile(fileMenu.items[fileMenu.selected] ?? fileMenu.items[0])
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              setMenu(prev => (prev.open ? { open: false, prefix: '' } : prev))
              closeFileMenu()
            }
          }}
        />
      </div>
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
      <div className="chat-input-toolbar">
        <button
          className="chat-input-attach"
          title="Upload file"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="btn-icon"><PaperclipIcon /></span>
          Upload file
        </button>
        <span className="chat-input-toolbar-spacer" />
        {running && (
          <button className="chat-input-stop" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </div>
  )
})
