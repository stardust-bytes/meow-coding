import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('chat feed scrollbar reflects the full transcript (no content-visibility collapse)', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-scroll-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-scroll-project-'))
  try {
    const agentId = 'e2e-meow'
    const workspaces = [{
      projectPath: project,
      name: 'Scroll Test',
      agents: [
        { id: agentId, name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }
      ]
    }]
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))

    const now = Date.now()
    const items: Array<{ kind: string; message: { id: string; role: string; text: string; createdAt: number } }> = []
    for (let i = 0; i < 60; i++) {
      items.push({ kind: 'message', message: { id: `u-${i}`, role: 'user', text: `user question ${i}`, createdAt: now + i } })
      items.push({
        kind: 'message',
        message: {
          id: `a-${i}`,
          role: 'assistant',
          text: `assistant answer ${i}\n` + 'detail line\n'.repeat(30 + (i % 4) * 10),
          createdAt: now + i + 1
        }
      })
    }
    const sessions = [{
      id: 'sess-1',
      agentId,
      projectPath: project,
      title: 'Long transcript',
      items,
      todos: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      createdAt: now,
      updatedAt: now
    }]
    writeFileSync(path.join(userData, 'sessions.json'), JSON.stringify(sessions, null, 2))

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-row').click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      const feed = window.locator('.chat-feed')
      await expect(feed.locator('.chat-msg')).toHaveCount(120)

      // Regression: the scrollbar must represent the whole transcript. A
      // content-visibility row inside a flex-column feed used to reserve zero
      // height when skipped, collapsing scrollHeight to a couple of viewports.
      await expect.poll(() => feed.evaluate(el => el.scrollHeight / el.clientHeight), {
        timeout: 5000
      }).toBeGreaterThan(8)

      // Opening the project must land the feed at the real bottom, even though
      // content-visibility rows settle their true heights a few frames late.
      await expect.poll(() => feed.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight), {
        timeout: 5000
      }).toBeLessThan(4)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
