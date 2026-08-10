import { useCallback, useEffect, useState } from 'react'
import type { ChatGptWebStatus } from '@shared/types'

export default function ChatGptWebTab() {
  const [status, setStatus] = useState<ChatGptWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void window.api.getChatGptWebStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async () => {
    if (!status) return
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.setChatGptWebEnabled(!status.enabled))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.loginChatGptWeb())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.logoutChatGptWeb())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="settings-tab chatgpt-web-tab">Loading…</div>

  return (
    <div className="settings-tab chatgpt-web-tab">
      <div className="chatgpt-web-banner">
        <strong>Experimental.</strong> This drives a real, logged-in ChatGPT web session through
        browser automation — it is not an official API. It can break when ChatGPT changes its UI,
        and usage is subject to your own ChatGPT account's Terms of Use. Official providers
        (Anthropic/Google/OpenAI-compatible) remain the primary, supported path.
      </div>

      <div className="chatgpt-web-row">
        <span>Enable chatgpt-web provider</span>
        <button className="btn" disabled={busy} onClick={() => void toggle()}>
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="chatgpt-web-row">
        <span>
          Session:{' '}
          {status.loggedIn
            ? `logged in (verified ${new Date(status.verifiedAt ?? '').toLocaleString()})`
            : 'not logged in'}
        </span>
        {status.loggedIn ? (
          <button className="btn" disabled={busy} onClick={() => void logout()}>Logout</button>
        ) : (
          <button className="btn primary" disabled={busy || !status.enabled} onClick={() => void login()}>
            {busy ? 'Waiting for login…' : 'Login with ChatGPT'}
          </button>
        )}
      </div>

      {!status.enabled && <p className="settings-hint">Enable the provider first to log in.</p>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
