import { useState } from 'react'

interface Props {
  disabled: boolean
  onSubmit(text: string): void
}

export default function ChatInput({ disabled, onSubmit }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
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
        disabled={disabled}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button className="chat-input-send" onClick={submit} disabled={disabled}>
        Send
      </button>
    </div>
  )
}
