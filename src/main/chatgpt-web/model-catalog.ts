import type { ModelRef } from '../../shared/types'

export const CHATGPT_WEB_PROVIDER_ID = 'chatgpt-web'

export interface ChatGptWebEffortLevel {
  id: string
  label: string
  uiEffortIndex: number
}

// uiEffortIndex matches the position of the corresponding item in ChatGPT's
// composer effort/model menu (0 = fastest, 4 = highest quality). Reconfirm
// against the live menu in Task 7 — ChatGPT's own labels may drift.
export const CHATGPT_WEB_EFFORT_LEVELS: ChatGptWebEffortLevel[] = [
  { id: 'light', label: 'Instant', uiEffortIndex: 0 },
  { id: 'medium', label: 'Medium', uiEffortIndex: 1 },
  { id: 'high', label: 'High', uiEffortIndex: 2 },
  { id: 'xhigh', label: 'Extra High', uiEffortIndex: 3 },
  { id: 'pro', label: 'Pro', uiEffortIndex: 4 }
]

export function getChatGptWebModelRefs(): ModelRef[] {
  return CHATGPT_WEB_EFFORT_LEVELS.map(e => ({ provider: CHATGPT_WEB_PROVIDER_ID, model: e.id }))
}

export function resolveChatGptWebEffort(model: string): ChatGptWebEffortLevel | null {
  return CHATGPT_WEB_EFFORT_LEVELS.find(e => e.id === model) ?? null
}
