import { useState } from 'react'
import type { AgentMode } from '@shared/types'

interface Props {
  running: boolean
  mode: AgentMode
  onSubmit(text: string): void
  onStop(): void
}

export default function ChatInput({ running, mode, onSubmit, onStop }: Props) {
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
        className={`chat-input-field mode-${mode}`}
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
