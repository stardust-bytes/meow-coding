import { describe, expect, it } from 'vitest'
import { parseCommandInput } from '../../src/renderer/src/components/chat/parseCommandInput'

describe('parseCommandInput', () => {
  it('detects a bare slash as a command with empty prefix', () => {
    expect(parseCommandInput('/')).toEqual({ isCommand: true, prefix: '' })
  })

  it('extracts a lowercase prefix from a partial command', () => {
    expect(parseCommandInput('/Review')).toEqual({ isCommand: true, prefix: 'review' })
  })

  it('is not a command once a space follows the first word', () => {
    expect(parseCommandInput('/review pr')).toEqual({ isCommand: false, prefix: '' })
  })

  it('is not a command for plain text', () => {
    expect(parseCommandInput('hello')).toEqual({ isCommand: false, prefix: '' })
  })

  it('is not a command for empty input', () => {
    expect(parseCommandInput('')).toEqual({ isCommand: false, prefix: '' })
  })
})
