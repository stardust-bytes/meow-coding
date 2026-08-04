import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and shows the main window', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window).toHaveTitle(/Meow Coding/)
  await expect(window.locator('.sidebar')).toBeVisible()
  await app.close()
})
