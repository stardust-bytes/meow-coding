import type { ChallengeEvent } from '@shared/ipc'

interface ChallengeToastProps {
  challenge: ChallengeEvent | null
  onDismiss: () => void
}

const MESSAGES: Record<ChallengeEvent['reason'], string> = {
  cloudflare: '[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở.',
  'session-expired': '[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.'
}

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  top: 24,
  right: 24,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  background: '#2a2a2a',
  color: '#fff',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  maxWidth: 480,
  fontSize: 13,
  lineHeight: 1.4
}

const dismissStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#fff',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 4px',
  opacity: 0.7
}

export function ChallengeToast({ challenge, onDismiss }: ChallengeToastProps) {
  if (!challenge) return null
  return (
    <div style={toastStyle} role="alert" aria-live="polite">
      <span style={{ flex: 1 }}>{MESSAGES[challenge.reason]}</span>
      <button
        type="button"
        style={dismissStyle}
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}