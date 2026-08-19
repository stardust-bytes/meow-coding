import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { RemoteSettingsStore, type RemoteSettings } from '../../src/main/remote/remote-settings'
import { RemotePairing } from '../../src/main/remote/remote-pairing'

const FIVE_MINUTES = 5 * 60_000
const LOCKOUT = 30_000

function makeClock() {
  let now = 1_000_000
  return {
    now: () => now,
    advance: (ms: number) => { now += ms },
    sleep: async () => {}
  }
}

function makePairing() {
  const clock = makeClock()
  const pairing = new RemotePairing({ now: clock.now, sleep: clock.sleep })
  return { pairing, clock }
}

function wrongCode(code: string): string {
  return code === '000000' ? '000001' : '000000'
}

describe('RemotePairing', () => {
  it('startPairing returns a fresh 6-digit code with a 5 minute TTL', () => {
    const { pairing, clock } = makePairing()
    const { code, expiresAt } = pairing.startPairing()
    expect(code).toMatch(/^\d{6}$/)
    expect(expiresAt).toBe(clock.now() + FIVE_MINUTES)
  })

  it('only keeps one active code', () => {
    const { pairing } = makePairing()
    const first = pairing.startPairing()
    const second = pairing.startPairing()
    expect(second.code).not.toBe(first.code)
    expect(pairing.validatePairingCode(first.code)).toBe(false)
    expect(pairing.validatePairingCode(second.code)).toBe(true)
  })

  it('rejects wrong codes and accepts the right one', () => {
    const { pairing } = makePairing()
    const { code } = pairing.startPairing()
    expect(pairing.validatePairingCode(wrongCode(code))).toBe(false)
    expect(pairing.validatePairingCode(code)).toBe(true)
  })

  it('locks for 30s after 5 wrong attempts', () => {
    const { pairing, clock } = makePairing()
    const { code } = pairing.startPairing()
    for (let i = 0; i < 5; i++) {
      expect(pairing.validatePairingCode(wrongCode(code))).toBe(false)
    }
    // locked: even the correct code is rejected
    expect(pairing.validatePairingCode(code)).toBe(false)
    // after the lockout elapses, the correct code works again
    clock.advance(LOCKOUT)
    expect(pairing.validatePairingCode(code)).toBe(true)
  })

  it('rejects the code after its TTL expires', () => {
    const { pairing, clock } = makePairing()
    const { code } = pairing.startPairing()
    clock.advance(FIVE_MINUTES + 1)
    expect(pairing.validatePairingCode(code)).toBe(false)
  })

  it('issueToken returns a 256-bit hex token and validateToken matches it', () => {
    const { pairing } = makePairing()
    const token = pairing.issueToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(pairing.validateToken(token)).toBe(true)
    expect(pairing.validateToken('deadbeef')).toBe(false)
  })

  it('validateToken is not timing-sensitive for length mismatches', () => {
    const { pairing } = makePairing()
    const token = pairing.issueToken()
    const short = token.slice(0, 32)
    const long = token + '0'
    expect(() => pairing.validateToken(short)).not.toThrow()
    expect(() => pairing.validateToken(long)).not.toThrow()
    expect(pairing.validateToken(short)).toBe(false)
    expect(pairing.validateToken(long)).toBe(false)
  })

  it('revokeToken invalidates the token', () => {
    const { pairing } = makePairing()
    const token = pairing.issueToken()
    pairing.revokeToken()
    expect(pairing.validateToken(token)).toBe(false)
  })

  it('setToken restores a previously issued token', () => {
    const { pairing } = makePairing()
    const token = pairing.issueToken()
    pairing.revokeToken()
    pairing.setToken(token)
    expect(pairing.validateToken(token)).toBe(true)
  })

  it('locks validateToken after 2 wrong attempts', () => {
    const { pairing, clock } = makePairing()
    const token = pairing.issueToken()
    expect(pairing.validateToken('wrong-1')).toBe(false)
    expect(pairing.validateToken('wrong-2')).toBe(false)
    // locked: even the correct token is rejected
    expect(pairing.validateToken(token)).toBe(false)
    clock.advance(LOCKOUT)
    expect(pairing.validateToken(token)).toBe(true)
  })

  it('reset clears pairing code and token', () => {
    const { pairing } = makePairing()
    const { code } = pairing.startPairing()
    const token = pairing.issueToken()
    pairing.reset()
    expect(pairing.validatePairingCode(code)).toBe(false)
    expect(pairing.validateToken(token)).toBe(false)
  })
})

describe('RemoteSettingsStore', () => {
  let file: string

  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-remote-'))
    file = path.join(dir, 'remote.json')
  })

  afterEach(() => rmSync(path.dirname(file), { recursive: true, force: true }))

  it('returns defaults and persists them when nothing is stored', () => {
    const store = new RemoteSettingsStore(createJsonStore(file))
    const s = store.load()
    expect(s).toMatchObject({ enabled: false, relayUrl: '' })
    expect(s.deviceId).toBeTruthy()
    // the default is persisted so the device id stays stable across restarts
    const reloaded = new RemoteSettingsStore(createJsonStore(file)).load()
    expect(reloaded.deviceId).toBe(s.deviceId)
    expect(reloaded.enabled).toBe(false)
  })

  it('saves settings and loads them back', () => {
    const store = new RemoteSettingsStore(createJsonStore(file))
    const settings: RemoteSettings = {
      enabled: true,
      relayUrl: 'wss://relay.example',
      deviceId: 'device-1',
      sessionToken: 'tok'
    }
    store.save(settings)
    const reloaded = new RemoteSettingsStore(createJsonStore(file)).load()
    expect(reloaded).toEqual(settings)
  })
})
