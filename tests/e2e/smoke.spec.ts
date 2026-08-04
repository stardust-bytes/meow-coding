import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('app launches and shows the main window', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window).toHaveTitle(/Meow Coding/)
  await expect(window.locator('.sidebar')).toBeVisible()
  await app.close()
})

test('native meow agent renders a chat panel and sends a message', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    const workspaces = [{
      projectPath: project,
      name: 'E2E Project',
      agents: [
        { id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }
      ]
    }]
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-row').click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-send').click()
      await expect(window.locator('.chat-msg.user').last()).toContainText('hello meow')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('settings dialog adds a provider and saves', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([]))

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await window.getByRole('button', { name: 'settings' }).click()
      await expect(window.locator('.settings-dialog')).toBeVisible()

      await window.locator('.settings-actions select').selectOption('deepseek')
      await window.getByRole('button', { name: 'add' }).click()
      await window.locator('.provider-row').last().locator('input[type="password"]').fill('sk-test')

      await window.getByRole('button', { name: 'Save' }).click()
      await expect(window.locator('.settings-dialog')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
