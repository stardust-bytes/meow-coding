import { describe, expect, it } from 'vitest'
import { decidePermission } from '../../src/main/agent/permission'

describe('decidePermission', () => {
  it('uses an exact rule match', () => {
    expect(decidePermission({ bash: 'deny' }, 'bash')).toBe('deny')
    expect(decidePermission({ write: 'allow' }, 'write')).toBe('allow')
    expect(decidePermission({ read: 'ask' }, 'read')).toBe('ask')
  })

  it('defaults to ask when no rule matches', () => {
    expect(decidePermission({}, 'bash')).toBe('ask')
    expect(decidePermission({ bash: 'allow' }, 'read')).toBe('ask')
  })

  it('matches a star wildcard as fallback', () => {
    expect(decidePermission({ '*': 'deny' }, 'read')).toBe('deny')
    expect(decidePermission({ '*': 'allow', bash: 'ask' }, 'bash')).toBe('ask')
  })

  it('matches a prefix wildcard', () => {
    expect(decidePermission({ 'web*': 'allow' }, 'webfetch')).toBe('allow')
    expect(decidePermission({ 'web*': 'deny' }, 'websearch')).toBe('deny')
  })

  it('prefers an exact rule over a wildcard', () => {
    expect(decidePermission({ '*': 'allow', bash: 'deny' }, 'bash')).toBe('deny')
  })
})
