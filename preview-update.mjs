import { _electron as electron } from '@playwright/test'
const app = await electron.launch({ args: ['.'] })
const win = await app.firstWindow()
await win.waitForTimeout(2500)
await app.evaluate(async ({ BrowserWindow }, channel, payload) => {
  const [w] = BrowserWindow.getAllWindows()
  w.webContents.send(channel, payload)
}, 'updater:status', {
  type: 'update-available',
  version: '0.25.6',
  currentVersion: '0.25.5',
  releaseNotes: '# What’s new in 0.25.6\n\n- **Steering**: messages sent while the agent is running are injected into the turn.\n- Collapsible tool call cards.\n- Close buttons on all dialogs.\n\n> Tip: try the new Send button.\n\n```\ncode block with a long line that goes on and on to test wrapping behavior\n```\n\n| Feature | Status |\n| --- | --- |\n| Tray | ✅ Done |\n| Steering | ✅ Done |'
})
await win.waitForTimeout(1500)
await win.screenshot({ path: 'preview-update.png' })
console.log('screenshot saved')
await app.close()
