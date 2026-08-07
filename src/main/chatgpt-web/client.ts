import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../agent/llm'
import { compileChatGptWebPrompt } from './prompt'
import { parseChatGptWebResponse } from './response-parser'
import { resolveChatGptWebEffort } from './model-catalog'
import type { ChatGptWebSessionStore } from './session-store'

export function createChatGptWebLlmClient(store: ChatGptWebSessionStore): LlmClient {
  return {
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      const effort = resolveChatGptWebEffort(opts.model)
      if (!effort) {
        yield { kind: 'error', error: `Unknown chatgpt-web model "${opts.model}"` }
        return
      }

      const { createChatGptWebPage, runChatGptWebTurn, CHATGPT_WEB_TAB_LIMITER } = await import('./browser-worker')
      const cfg = store.loadConfig()
      const release = await CHATGPT_WEB_TAB_LIMITER.acquire()
      try {
        const prompt = compileChatGptWebPrompt(opts)
        const page = await createChatGptWebPage(store.storageStatePath(), cfg.chromeExecutablePath)
        const markdown = await runChatGptWebTurn(page, prompt, effort, opts.signal)
        for (const part of parseChatGptWebResponse(markdown)) yield part
        yield { kind: 'finish', finishReason: 'stop' }
      } catch (err) {
        yield { kind: 'error', error: err instanceof Error ? err.message : String(err) }
      } finally {
        release()
      }
    }
  }
}
