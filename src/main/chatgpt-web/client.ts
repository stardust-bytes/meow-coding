import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../agent/llm'
import { compileChatGptWebPrompt } from './prompt'
import { parseChatGptWebResponse } from './response-parser'
import { resolveChatGptWebEffort } from './model-catalog'
import type { ChatGptWebSessionStore } from './session-store'
import type { ChallengeEvent } from '../../shared/ipc'

export function createChatGptWebLlmClient(
  store: ChatGptWebSessionStore,
  deps: { notifyChallenge?: (event: ChallengeEvent) => void } = {}
): LlmClient {
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
        const userDataDir = store.userDataDir()
        const storageStatePath = store.storageStatePath()
        const chromePath = cfg.chromeExecutablePath
        const page = await createChatGptWebPage(userDataDir, storageStatePath, chromePath)
        const recreate = async (mode: 'headless' | 'visible'): Promise<import('./browser-worker').ChatGptWebPage> => {
          await page.close().catch(() => undefined)
          return createChatGptWebPage(userDataDir, storageStatePath, chromePath, mode)
        }
        const markdown = await runChatGptWebTurn(page, recreate, prompt, effort, opts.signal, {
          onFallback: (reason) => deps.notifyChallenge?.({ reason, timestamp: new Date().toISOString() })
        })
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