import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, ChatMessage, ToolCallData } from '@shared/types'
import ChatInput from './ChatInput'
import ToolCallCard from './ToolCallCard'

type FeedItem =
  | { kind: 'message'; id: string; role: ChatMessage['role']; text: string }
  | { kind: 'tool'; id: string; call: ToolCallData }
  | { kind: 'prompt'; id: string; promptId: string; promptType: 'permission' | 'question'; call?: ToolCallData; question?: string }
  | { kind: 'error'; id: string; text: string }

interface Props {
  agentId: string
}

export default function ChatPanel({ agentId }: Props) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.listChatMessages(agentId).then(msgs => {
      setItems(msgs.map(m => ({ kind: 'message', id: m.id, role: m.role, text: m.text })))
    })
    const off = window.api.onChatEvent(e => applyEvent(e))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  const applyEvent = useCallback((e: ChatEvent) => {
    if (e.agentId !== agentId) return
    if (e.type === 'done' || e.type === 'error') {
      setRunning(false)
      if (e.type === 'error') {
        setItems(prev => [...prev, { kind: 'error', id: 'err-' + Date.now(), text: e.message }])
      }
      return
    }
    setItems(prev => {
      const next = [...prev]
      if (e.type === 'text-delta') {
        const last = next[next.length - 1]
        if (last && last.kind === 'message' && last.role === 'assistant') {
          last.text += e.delta
        } else {
          next.push({ kind: 'message', id: 'a-' + Date.now(), role: 'assistant', text: e.delta })
        }
      } else if (e.type === 'tool-start') {
        next.push({ kind: 'tool', id: e.call.id, call: { ...e.call } })
      } else if (e.type === 'tool-result') {
        const idx = next.findIndex(i => i.kind === 'tool' && i.id === e.call.id)
        if (idx >= 0) next[idx] = { kind: 'tool', id: e.call.id, call: { ...e.call } }
      } else if (e.type === 'prompt-request') {
        next.push({
          kind: 'prompt', id: e.promptId, promptId: e.promptId, promptType: e.kind,
          call: e.call, question: e.question
        })
      }
      return next
    })
  }, [agentId])

  const send = useCallback((text: string) => {
    setItems(prev => [...prev, { kind: 'message', id: 'u-' + Date.now(), role: 'user', text }])
    setRunning(true)
    void window.api.sendChat(agentId, text)
  }, [agentId])

  const respond = useCallback((promptId: string, allow: boolean, text?: string) => {
    void window.api.respondPrompt(agentId, promptId, { allow, text })
    setItems(prev => prev.filter(i => !(i.kind === 'prompt' && i.promptId === promptId)))
  }, [agentId])

  return (
    <div className="chat-panel">
      <div className="chat-feed">
        {items.map(item => {
          if (item.kind === 'message') {
            return (
              <div key={item.id} className={`chat-msg ${item.role}`}>
                <div className="chat-text">{item.text}</div>
              </div>
            )
          }
          if (item.kind === 'tool') {
            return <ToolCallCard key={item.id} call={item.call} />
          }
          if (item.kind === 'error') {
            return <div key={item.id} className="chat-error">{item.text}</div>
          }
          return (
            <div key={item.id} className="chat-prompt">
              {item.promptType === 'permission' ? (
                <>
                  <div className="chat-prompt-text">
                    Meow wants to run <code>{item.call?.tool}</code>:
                  </div>
                  <pre className="tool-call-input">{JSON.stringify(item.call?.input ?? {}, null, 2)}</pre>
                  <div className="chat-prompt-actions">
                    <button className="allow" onClick={() => respond(item.promptId, true)}>Allow</button>
                    <button onClick={() => respond(item.promptId, false)}>Deny</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="chat-prompt-text">{item.question}</div>
                  <div className="chat-prompt-actions">
                    <input
                      className="chat-prompt-input"
                      value={questionText}
                      placeholder="Answer..."
                      onChange={e => setQuestionText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          respond(item.promptId, true, questionText)
                          setQuestionText('')
                        }
                      }}
                    />
                    <button onClick={() => respond(item.promptId, true, questionText)}>Send</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {running && <div className="chat-running">Meow is working…</div>}
        <div ref={endRef} />
      </div>
      <div className="chat-composer">
        {running && (
          <button className="chat-stop" onClick={() => void window.api.stopChat(agentId)}>Stop</button>
        )}
        <ChatInput disabled={running} onSubmit={send} />
      </div>
    </div>
  )
}
