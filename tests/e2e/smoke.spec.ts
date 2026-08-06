import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('app launches and shows the main window', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window).toHaveTitle(/Meow Coding/)
  await expect(window.locator('.sidebar')).toBeVisible()
  // Version loads asynchronously via IPC; auto-wait for it to appear.
  const version = window.locator('.status-bar .sb-mono').last()
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/)
  expect(await version.textContent()).not.toBe('v0.1.0')
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

      await window.getByRole('button', { name: 'menu E2E Project' }).click()
      await expect(window.getByRole('button', { name: 'Open in VS Code' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Remove' })).toBeVisible()
      await window.keyboard.press('Escape')

      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.user').last()).toContainText('hello meow')

      await window.getByRole('button', { name: 'plan' }).click()
      await expect(window.locator('.chat-mode-hint')).toBeVisible()
      await window.getByRole('button', { name: 'build' }).click()
      await expect(window.locator('.chat-mode-hint')).toHaveCount(0)

      await window.locator('.chat-input-field').focus()
      await window.keyboard.press('Tab')
      await expect(window.locator('.chat-mode-hint')).toBeVisible()
      await window.keyboard.press('Tab')
      await expect(window.locator('.chat-mode-hint')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('settings screen connects a provider and syncs models', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([]))
    // seed the models.dev cache so the test works offline
    writeFileSync(path.join(userData, 'models.json'), JSON.stringify({
      fetchedAt: Date.now(),
      providers: {
        deepseek: {
          name: 'DeepSeek',
          api: 'https://api.deepseek.com',
          models: ['deepseek-chat', 'deepseek-reasoner']
        }
      }
    }))

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await window.getByRole('button', { name: 'menu' }).click()
      await window.getByRole('button', { name: 'settings' }).click()
      await expect(window.locator('.settings-dialog')).toBeVisible()
      await expect(window.locator('.settings-nav-item', { hasText: 'Providers' })).toBeVisible()

      await window.locator('.provider-search').fill('deepseek')
      await window.locator('.provider-catalog-row', { hasText: 'deepseek' }).getByRole('button', { name: 'connect' }).click()
      const popup = window.locator('.dialog:not(.settings-dialog)')
      await expect(popup).toBeVisible()
      await popup.locator('.provider-key').fill('sk-test')
      await popup.locator('.submit').click()

      await expect(window.locator('.provider-connected')).toContainText('deepseek')
      await expect(window.locator('.settings-status').last()).toContainText('2 model(s) synced')
      // deepseek is the first provider, so it auto-becomes default.
      await expect(window.getByRole('button', { name: 'default', exact: true })).toBeVisible()
      // Add a second provider so 'set default' is exercised on deepseek.
      await window.getByRole('button', { name: '+ Connect provider' }).click()
      const manualPopup = window.locator('.dialog:not(.settings-dialog)')
      await manualPopup.getByPlaceholder('provider id (e.g. deepseek)').fill('other')
      await manualPopup.getByPlaceholder('api key').fill('sk-other')
      await manualPopup.locator('.submit').click()
      await expect(window.locator('.provider-connected')).toContainText('other')
      // 'other' auto-becomes default; deepseek now offers 'set default'.
      await expect(window.getByRole('button', { name: 'set default' })).toBeVisible()
      await window.getByRole('button', { name: 'set default' }).click()
      // Clicking persists immediately and flips the label.
      await expect(window.getByRole('button', { name: 'default', exact: true })).toBeVisible()
      await window.getByRole('button', { name: 'Save' }).click()
      await expect(window.locator('.settings-status').last()).toContainText('saved')
      await window.getByRole('button', { name: 'Cancel' }).click()
      await expect(window.locator('.settings-dialog')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
