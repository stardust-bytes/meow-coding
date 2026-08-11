import type { QuestionOption } from '@shared/types'

// Builds the submitted answer text for a question prompt. The typed input
// counts as the answer whenever the input is visible: either the user
// explicitly opened custom input, or the question has no options at all
// (pure text question) — in which case the input is shown by default.
export function buildQuestionAnswer(args: {
  options?: QuestionOption[]
  customInput: boolean
  questionText: string
  selectedOptions: string[]
}): string {
  const parts = [...args.selectedOptions]
  const inputVisible = args.customInput || !args.options?.length
  if (inputVisible && args.questionText.trim()) parts.push(args.questionText.trim())
  return parts.join(', ')
}
