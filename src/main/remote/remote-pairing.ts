import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export interface RemotePairingDeps {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const CODE_TTL_MS = 5 * 60_000
const CODE_MAX_ATTEMPTS = 5
const TOKEN_MAX_ATTEMPTS = 2
const LOCKOUT_MS = 30_000

export class RemotePairing {
  private code = ''
  private codeExpiresAt = 0
  private codeFailedAttempts = 0
  private codeLockedUntil = 0
  private token: string | null = null
  private tokenFailedAttempts = 0
  private tokenLockedUntil = 0

  constructor(private deps: RemotePairingDeps = {}) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  startPairing(): { code: string; expiresAt: number } {
    this.code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    this.codeExpiresAt = this.now() + CODE_TTL_MS
    this.codeFailedAttempts = 0
    this.codeLockedUntil = 0
    return { code: this.code, expiresAt: this.codeExpiresAt }
  }

  validatePairingCode(code: string): boolean {
    const now = this.now()
    if (this.codeLockedUntil > 0) {
      if (now < this.codeLockedUntil) return false
      this.codeLockedUntil = 0
      this.codeFailedAttempts = 0
    }
    if (!this.code || now >= this.codeExpiresAt) return false
    if (code === this.code) {
      this.codeFailedAttempts = 0
      return true
    }
    this.codeFailedAttempts++
    if (this.codeFailedAttempts >= CODE_MAX_ATTEMPTS) {
      this.codeLockedUntil = now + LOCKOUT_MS
    }
    return false
  }

  setToken(token: string): void {
    this.token = token
    this.tokenFailedAttempts = 0
    this.tokenLockedUntil = 0
  }

  issueToken(): string {
    this.token = randomBytes(32).toString('hex')
    this.tokenFailedAttempts = 0
    this.tokenLockedUntil = 0
    return this.token
  }

  validateToken(token: string): boolean {
    const now = this.now()
    if (this.tokenLockedUntil > 0) {
      if (now < this.tokenLockedUntil) return false
      this.tokenLockedUntil = 0
      this.tokenFailedAttempts = 0
    }
    if (!this.token) return false
    const valid = constantTimeEqual(this.token, token)
    if (valid) {
      this.tokenFailedAttempts = 0
    } else {
      this.tokenFailedAttempts++
      if (this.tokenFailedAttempts >= TOKEN_MAX_ATTEMPTS) {
        this.tokenLockedUntil = now + LOCKOUT_MS
      }
    }
    return valid
  }

  revokeToken(): void {
    this.token = null
    this.tokenFailedAttempts = 0
    this.tokenLockedUntil = 0
  }

  reset(): void {
    this.code = ''
    this.codeExpiresAt = 0
    this.codeFailedAttempts = 0
    this.codeLockedUntil = 0
    this.token = null
    this.tokenFailedAttempts = 0
    this.tokenLockedUntil = 0
  }
}

// timingSafeEqual requires equal-length buffers; short-circuit on length
// mismatch so it never throws and never leaks timing for different lengths
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
