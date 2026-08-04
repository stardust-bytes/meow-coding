import { useState } from 'react'

interface Props {
  running: boolean
  onSubmit(text: string): void
  onStop(): void
}

export default function ChatInput({ running, onSubmit, onStop }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const text = value.trim()
    if (!text || running) return
    setValue('')
    onSubmit(text)
  }

  return (
    <div className="chat-input">
      <textarea
        className="chat-input-field"
        value={value}
        placeholder="Message Meow..."
        rows={2}
        disabled={running}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
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
}
