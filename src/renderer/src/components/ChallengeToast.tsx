import type { ChallengeEvent } from '@shared/ipc'
import styles from './ChallengeToast.module.scss'

interface ChallengeToastProps {
  challenge: ChallengeEvent | null
  onDismiss: () => void
}

const MESSAGES: Record<ChallengeEvent['reason'], string> = {
  cloudflare: '[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở.',
  'session-expired': '[meow] Phiên đăng nhập ChatGPT đã hết hạn. Vui lòng đăng nhập lại từ Settings.'
}

export function ChallengeToast({ challenge, onDismiss }: ChallengeToastProps) {
  if (!challenge) return null
  return (
    <div className={styles.toast} role="alert" aria-live="polite">
      <span className={styles.message}>{MESSAGES[challenge.reason]}</span>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}