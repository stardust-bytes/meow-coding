import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('native agent Trace tab renders the trace ledger', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-trace-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-trace-project-'))
  try {
    const agentId = 'e2e-trace'
    const workspaces = [{
      projectPath: project,
      name: 'Trace Test',
      agents: [
        { id: agentId, name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }
      ]
    }]
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))

    const now = Date.now()
    const sessions = [{
      id: 'sess-1',
      agentId,
      projectPath: project,
      title: 'Trace session',
      items: [
        { kind: 'message', message: { id: 'u-1', role: 'user', text: 'hello', createdAt: now } },
        { kind: 'message', message: { id: 'a-1', role: 'assistant', text: 'hi', createdAt: now + 1 } }
      ],
      todos: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      createdAt: now,
      updatedAt: now
    }]
    writeFileSync(path.join(userData, 'sessions.json'), JSON.stringify(sessions, null, 2))

    const traceDir = path.join(userData, 'traces')
    mkdirSync(traceDir, { recursive: true })
    const traceLines = [
      { seq: 1, ts: 1700000000000, agentId, sessionId: 'sess-1', type: 'turn-started', turn: 1 },
      { seq: 2, ts: 1700000000500, agentId, sessionId: 'sess-1', type: 'message', turn: 1, role: 'assistant', text: 'Let me read the config file to understand the setup.' },
      { seq: 3, ts: 1700000001000, agentId, sessionId: 'sess-1', type: 'tool-start', turn: 1, callId: 'c1', tool: 'read', input: { file_path: 'x' } },
      { seq: 4, ts: 1700000002000, agentId, sessionId: 'sess-1', type: 'tool-result', turn: 1, callId: 'c1', tool: 'read', output: 'content', durationMs: 1000 },
      { seq: 5, ts: 1700000003000, agentId, sessionId: 'sess-1', type: 'done', reason: 'complete' }
    ]
    writeFileSync(path.join(traceDir, 'sess-1.jsonl'), traceLines.map(l => JSON.stringify(l)).join('\n') + '\n')

    // Trace is app-disabled by default; enable it via config so the tab shows.
    writeFileSync(path.join(userData, 'meow.json'), JSON.stringify({ trace: { enabled: true } }))

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-row').click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      await window.locator('.pane-tab', { hasText: 'Trace' }).click()
      await expect(window.locator('.trace-panel')).toBeVisible()

      const header = window.locator('.trace-turn-header')
      await expect(header.first()).toContainText('Turn 1')

      // Assistant content is expanded by default (not just a truncated label).
      await expect(window.locator('.trace-detail').filter({ hasText: 'Let me read the config file' }).first()).toBeVisible()

      const toolRow = window.locator('.trace-row').filter({ hasText: 'read' })
      await expect(toolRow.first()).toBeVisible()

      // Tool rows start collapsed; expanding the tool-result row reveals the
      // full output ("content"), not just the ✓ label.
      const resultRow = window.locator('.trace-row').filter({ hasText: '✓ read' })
      await resultRow.locator('.trace-row-toggle').click()
      await expect(window.locator('.trace-detail').filter({ hasText: 'content' }).first()).toBeVisible()

      await toolRow.first().click()
      await expect(window.locator('.trace-inspector')).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
