import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function launchPrompt() {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project,
    name: 'E2E',
    agents: [{ id: 'a1', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }]))
  const app = await electron.launch({ args: ['.'], env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData } })
  const window = await app.firstWindow()
  await window.locator('.project-row').click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('chat:event', {
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'permission',
      call: { id: 'c1', tool: 'bash', input: { command: 'x' }, permission: 'pending' }
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  return { app, window }
}

test('click allow closes the prompt', async () => {
  const { app, window } = await launchPrompt()
  try {
    await window.locator('.chat-prompt-actions button.allow').click()
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('keyboard 1 triggers allow when panel focused', async () => {
  const { app, window } = await launchPrompt()
  try {
    await window.locator('.chat-mode').click()
    await window.keyboard.press('1')
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('prompt spans the pane width', async () => {
  const { app, window } = await launchPrompt()
  try {
    const panel = await window.locator('.chat-panel').boundingBox()
    const prompt = await window.locator('.chat-prompt').boundingBox()
    expect(prompt).not.toBeNull()
    expect(panel).not.toBeNull()
    expect(prompt!.width).toBeGreaterThan(panel!.width * 0.95)
  } finally {
    await app.close()
  }
})
