import { describe, expect, test } from 'vitest'
import { buildQuestionAnswer } from '../../src/renderer/src/components/chat/questionAnswer'

describe('buildQuestionAnswer', () => {
  test('text-only question (no options) submits the typed answer', () => {
    const text = buildQuestionAnswer({
      options: undefined,
      customInput: false,
      questionText: 'nguyen.vana',
      selectedOptions: []
    })
    expect(text).toBe('nguyen.vana')
  })

  test('text-only question with empty text returns empty', () => {
    const text = buildQuestionAnswer({
      options: undefined,
      customInput: false,
      questionText: '   ',
      selectedOptions: []
    })
    expect(text).toBe('')
  })

  test('selected options are kept when custom input is not active', () => {
    const text = buildQuestionAnswer({
      options: [{ label: 'Option A' }, { label: 'Option B' }],
      customInput: false,
      questionText: '',
      selectedOptions: ['Option A']
    })
    expect(text).toBe('Option A')
  })

  test('custom input text is appended after selected options', () => {
    const text = buildQuestionAnswer({
      options: [{ label: 'Option A' }],
      customInput: true,
      questionText: 'custom answer',
      selectedOptions: ['Option A']
    })
    expect(text).toBe('Option A, custom answer')
  })

  test('multiple selected options are joined with comma', () => {
    const text = buildQuestionAnswer({
      options: [{ label: 'A' }, { label: 'B' }],
      customInput: false,
      questionText: '',
      selectedOptions: ['A', 'B']
    })
    expect(text).toBe('A, B')
  })
})
