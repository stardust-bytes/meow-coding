import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

interface MockTurn {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// Fakes just enough of the OpenAI-compatible streaming chat endpoint
// (@ai-sdk/openai-compatible) for the real IPC -> manager -> loop -> llm
// pipeline to run end to end without a real provider API key.
function startMockLlm(turns: MockTurn[]): Promise<{ server: http.Server; port: number }> {
  let call = 0
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    req.on('data', () => {})
    req.on('end', () => {
      const turn = turns[Math.min(call, turns.length - 1)]
      call++
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = (obj: unknown): void => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`)
      }
      send({ id: 'mock-1', choices: [{ delta: { role: 'assistant', content: turn.content } }] })
      send({ id: 'mock-1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: turn.usage })
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

// Electron leaves cache file handles open briefly after app.close() on
// Windows; retry so that transient EPERM/EBUSY on cleanup never masks a real
// assertion failure from the try block above it.
function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function seedUserData(userData: string, project: string, meowConfig: Record<string, unknown>): void {
  const workspaces = [{
    projectPath: project,
    name: 'E2E Project',
    agents: [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }]
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  writeFileSync(path.join(userData, 'meow.json'), JSON.stringify(meowConfig, null, 2))
}

test('context footer shows real token usage, persists across reload, resets on new session', async () => {
  const { server, port } = await startMockLlm([
    { content: 'hi there', usage: { prompt_tokens: 3800, completion_tokens: 431, total_tokens: 4231 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
    })

    let app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    let window = await app.firstWindow()
    await expect(window.locator('.project-row')).toBeVisible()
    await window.locator('.project-row').click()
    await expect(window.locator('.chat-panel')).toBeVisible()

    // No messages yet -> placeholder, not a stale number.
    await expect(window.locator('.context-footer')).toContainText('—')

    await window.locator('.chat-input-field').fill('hello meow')
    await window.locator('.chat-input-send').click()
    await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

    const footer = window.locator('.context-footer')
    await expect(footer).toContainText('4,231')
    await expect(footer).toContainText('(2%)')
    await expect(footer).not.toHaveClass(/warn|danger/)

    await app.close()

    // Relaunch against the same user data / session: footer must read the
    // persisted ChatMessage.tokens, not reset to the placeholder.
    app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    window = await app.firstWindow()
    await window.locator('.project-row').click()
    await expect(window.locator('.context-footer')).toContainText('4,231')

    // New session -> back to placeholder.
    await window.locator('.session-trigger').click()
    await window.locator('.session-new').click()
    await expect(window.locator('.context-footer')).toContainText('—')

    await app.close()
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('context footer turns danger and shows the compacting note past the auto-compact threshold', async () => {
  const { server, port } = await startMockLlm([
    { content: 'near limit', usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    // maxContextTokens 1100 - buffer 100 = compactThreshold 1000, matched
    // exactly by the mock's reported total_tokens so contextLevel lands on
    // 'danger' (>=) without needing a second, warn-level turn.
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 1100,
      compaction: { auto: true, buffer: 100, keepTokens: 200, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
    })

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await window.locator('.project-row').click()
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-send').click()
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('near limit')

      const footer = window.locator('.context-footer')
      await expect(footer).toHaveClass(/danger/)
      await expect(footer).toContainText('compacting soon')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
