import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('app launches and shows the main window', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  try {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    try {
      const window = await app.firstWindow()
      await expect(window).toHaveTitle(/Meow Coding/)
      await expect(window.locator('.sidebar')).toBeVisible()
      // Version loads asynchronously via IPC; auto-wait for it to appear.
      const version = window.locator('.status-bar .sb-mono').last()
      await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/)
      expect(await version.textContent()).not.toBe('v0.1.0')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('settings opens below the title bar and returns to the app', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  try {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await window.getByRole('button', { name: 'Menu' }).click()
      await window.getByRole('button', { name: 'Settings' }).click()
      const backToApp = window.getByRole('button', { name: 'Back to app' })
      await expect(backToApp).toBeVisible()
      await expect(backToApp).toBeFocused()
      await expect.poll(() => backToApp.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('6px')
      const [settingsBox, titleBarBox] = await Promise.all([
        window.locator('.settings-screen').boundingBox(),
        window.locator('.title-bar').boundingBox()
      ])
      expect(settingsBox?.y).toBeGreaterThanOrEqual((titleBarBox?.y ?? 0) + (titleBarBox?.height ?? 0))
      const [navBox, contentBox, tabBox] = await Promise.all([
        window.locator('.settings-nav').boundingBox(),
        window.locator('.settings-content').boundingBox(),
        window.locator('.settings-content .settings-tab').first().boundingBox()
      ])
      expect(navBox?.x).toBeLessThanOrEqual((settingsBox?.x ?? 0) + 1)
      expect((contentBox?.x ?? 0) + (contentBox?.width ?? 0)).toBeGreaterThanOrEqual((settingsBox?.x ?? 0) + (settingsBox?.width ?? 0) - 1)
      // Content padding is symmetric: the tab is inset equally from both edges.
      expect((tabBox?.x ?? 0) - (contentBox?.x ?? 0)).toBeCloseTo(
        ((contentBox?.x ?? 0) + (contentBox?.width ?? 0)) - ((tabBox?.x ?? 0) + (tabBox?.width ?? 0)),
        0
      )
      await expect.poll(() => window.locator('.settings-nav').evaluate(element => getComputedStyle(element).paddingTop)).toBe('3.75px')
      await expect.poll(() => window.locator('.settings-content').evaluate(element => ({
        top: getComputedStyle(element).paddingTop,
        bottom: getComputedStyle(element).paddingBottom
      }))).toEqual({ top: '11.25px', bottom: '11.25px' })

      await window.getByRole('button', { name: 'MCP' }).click()
      await window.getByRole('button', { name: '+ Add server' }).click()
      const serverPopup = window.locator('.settings-screen .dialog')
      await expect(serverPopup).toBeVisible()
      await expect.poll(() => serverPopup.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('8px')
      await window.keyboard.press('Escape')
      await expect(serverPopup).toHaveCount(0)

      await backToApp.click()
      await expect(backToApp).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
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

      await window.getByRole('button', { name: 'Mode', exact: true }).click()
      await window.getByRole('button', { name: 'Plan', exact: true }).click()
      await expect(window.locator('.chat-mode-hint')).toBeVisible()
      await window.getByRole('button', { name: 'Mode', exact: true }).click()
      await window.getByRole('button', { name: 'Build', exact: true }).click()
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

test('pasted/attached image previews render in input, feed, and lightbox', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  // 1x1 transparent PNG (valid image data so naturalWidth reflects a decode)
  const pngPath = path.join(project, 'pixel.png')
  writeFileSync(pngPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  ))
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

      const field = window.locator('.chat-input-field')
      await field.click()

      // Ctrl+V path: dispatch a real paste event carrying an image file.
      await field.evaluate((el) => {
        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const dt = new DataTransfer()
        dt.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      })

      // The input chip thumbnail must actually decode the data: URL (CSP-blocked
      // images keep naturalWidth === 0 and never render).
      const chipThumb = window.locator('.chat-image-chip img.chat-image-thumb')
      await expect(chipThumb).toBeVisible()
      await expect.poll(() => chipThumb.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

      // Attach path: hidden file input triggers the same addImageFiles flow.
      await window.locator('.chat-input input[type="file"]').setInputFiles(pngPath)
      await expect(window.locator('.chat-image-chip img.chat-image-thumb')).toHaveCount(2)
      await expect.poll(() => window.locator('.chat-image-chip img.chat-image-thumb').last()
        .evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

      await field.fill('check the image')
      await field.press('Enter')

      // After sending, the user message shows the image thumbnails in the feed.
      const feedThumb = window.locator('.chat-msg.user img.chat-thumb')
      await expect(feedThumb).toHaveCount(2)
      await expect.poll(() => feedThumb.first()
        .evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

      // Lightbox preview also renders the data: URL.
      await feedThumb.first().click()
      const lightboxImg = window.locator('.chat-lightbox img')
      await expect(lightboxImg).toBeVisible()
      await expect.poll(() => lightboxImg.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('providers screen connects a provider and returns to the app', async () => {
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
      await window.getByRole('button', { name: 'Menu', exact: true }).click()
      await window.getByRole('button', { name: 'Providers' }).click()
      const backToApp = window.getByRole('button', { name: 'Back to app' })
      await expect(backToApp).toBeVisible()
      await expect(backToApp).toBeFocused()
      await expect.poll(() => backToApp.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('6px')
      await expect(backToApp.locator('svg')).toBeVisible()
      const [providersBox, titleBarBox] = await Promise.all([
        window.locator('.settings-screen').boundingBox(),
        window.locator('.title-bar').boundingBox()
      ])
      expect(providersBox?.y).toBeGreaterThanOrEqual((titleBarBox?.y ?? 0) + (titleBarBox?.height ?? 0))

      await window.locator('.provider-search').fill('deepseek')
      await window.locator('.provider-catalog-row', { hasText: 'deepseek' }).getByRole('button', { name: 'connect' }).click()
      const popup = window.locator('.dialog')
      await expect(popup).toBeVisible()
      await expect.poll(() => popup.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('8px')
      await popup.locator('.provider-key').fill('sk-test')
      await popup.locator('.submit').click()

      await expect(window.locator('.provider-connected')).toContainText('deepseek')
      await expect(window.locator('.settings-status').last()).toContainText('2 model(s) synced')
      // deepseek is the first provider, so it auto-becomes default.
      await expect(window.getByRole('button', { name: 'default', exact: true })).toBeVisible()
      // Add a second provider so 'set default' is exercised on deepseek.
      await window.getByRole('button', { name: '+ Connect provider' }).click()
      let manualPopup = window.locator('.dialog:not(.settings-dialog)')
      await window.keyboard.press('Escape')
      await expect(manualPopup).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Back to app' })).toBeVisible()

      await window.getByRole('button', { name: '+ Connect provider' }).click()
      manualPopup = window.locator('.dialog:not(.settings-dialog)')
      await manualPopup.getByPlaceholder('provider id (e.g. deepseek)').fill('other')
      await manualPopup.getByPlaceholder('api key').fill('sk-other')
      await manualPopup.locator('.submit').click()
      await expect(window.locator('.provider-connected')).toContainText('other')
      // 'other' auto-becomes default; deepseek now offers 'set default'.
      await expect(window.getByRole('button', { name: 'set default' })).toBeVisible()
      await window.getByRole('button', { name: 'set default' }).click()
      // Clicking persists immediately and flips the label.
      await expect(window.getByRole('button', { name: 'default', exact: true })).toBeVisible()
      await window.getByRole('button', { name: 'Back to app' }).click()
      await expect(window.getByRole('button', { name: 'Back to app' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('codex account models group under the account label in the model picker', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
      projectPath: project,
      name: 'E2E Project',
      agents: [
        { id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }
      ]
    }]))

    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env as Record<string, string>,
        MEOW_USER_DATA: userData,
        MEOW_E2E_MOCK_CONNECTIONS: '1'
      }
    })
    const window = await app.firstWindow()
    try {
      // The Codex OAuth section is hidden from the Providers screen; seed the
      // account via IPC so the picker can group its models under the label.
      await window.evaluate(() => window.api.connectCodex())

      await window.locator('.project-row').click()
      await expect(window.locator('.chat-panel')).toBeVisible()
      await window.locator('.model-trigger').click()
      await expect(window.locator('.model-group-head', { hasText: 'E2E Account' })).toBeVisible()
      await window.getByRole('button', { name: /gpt-5\.3-codex/ }).first().click()
      await expect(window.locator('.model-trigger')).toContainText('gpt-5.3-codex')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
