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
    await window.locator('.chat-panel').click()
    await window.keyboard.press('1')
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

async function launchQuestion() {
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
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'question',
      question: 'Please enter your username:', custom: true
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  return { app, window }
}

test('text-only question submits the typed answer', async () => {
  const { app, window } = await launchQuestion()
  try {
    await window.locator('.chat-prompt-input').fill('nguyen.vana')
    await window.locator('.chat-prompt-actions button', { hasText: 'Send' }).click()
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('prompt is rendered inside the chat input card', async () => {
  const { app, window } = await launchPrompt()
  try {
    const input = await window.locator('.chat-input').boundingBox()
    const prompt = await window.locator('.chat-prompt').boundingBox()
    expect(prompt).not.toBeNull()
    expect(input).not.toBeNull()
    // The prompt is in-flow at the top of the input card, so it sits inside it.
    expect(prompt!.x).toBeGreaterThanOrEqual(input!.x)
    expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(input!.x + input!.width + 1)
    expect(prompt!.y).toBeGreaterThanOrEqual(input!.y)
  } finally {
    await app.close()
  }
})

test('prompt does not overlay the chat feed', async () => {
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
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'question',
      question: 'Pick an option:', custom: true
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  const feedBox = await window.locator('.chat-feed').boundingBox()
  const prompt = await window.locator('.chat-prompt').boundingBox()
  try {
    expect(feedBox).not.toBeNull()
    expect(prompt).not.toBeNull()
    // The prompt lives in the composer card below the feed, so it must not
    // overlap the feed region.
    expect(prompt!.y).toBeGreaterThanOrEqual(feedBox!.y + feedBox!.height)
  } finally {
    await app.close()
  }
})
