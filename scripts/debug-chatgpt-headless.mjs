import { chromium } from 'playwright-core'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const candidates = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'meow-coding'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Meow Coding'),
  path.join(os.homedir(), 'AppData', 'Local', 'meow-coding'),
  path.join(os.homedir(), 'AppData', 'Local', 'Meow Coding')
]
const userDataDir = candidates.find(d => existsSync(path.join(d, 'chatgpt-web')))
const statePath = userDataDir ? path.join(userDataDir, 'chatgpt-web', 'storage-state.json') : null

if (!statePath || !existsSync(statePath)) {
  console.error('NO storage-state.json found under:')
  candidates.forEach(c => console.error('  ' + path.join(c, 'chatgpt-web', 'storage-state.json')))
  process.exit(1)
}

const state = JSON.parse(readFileSync(statePath, 'utf-8'))
console.log('storage state:')
console.log('  cookies:', state.cookies?.length ?? 0)
console.log('  origins:', state.origins?.length ?? 0)
const authUrl = state.cookies?.filter(c => c.name === '__Secure-next-auth.session-token' || c.name === 'cf_clearance').map(c => c.name + ' @ ' + c.domain) ?? []
console.log('  auth-ish cookies:', authUrl)

const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
]
const exe = chromePaths.find(existsSync)
if (!exe) { console.error('Chrome not found in default Windows paths'); process.exit(1) }
console.log('using chrome:', exe)

const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctx = await browser.newContext({ storageState: statePath })
const page = await ctx.newPage()
await page.goto('https://chatgpt.com/?temporary-chat=true', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

console.log('\nafter goto (2s settle):')
console.log('  url:  ', page.url())
console.log('  title:', await page.title())
console.log('  body length:', (await page.content()).length)
console.log('  #prompt-textarea count:', await page.locator('#prompt-textarea').count())

await page.screenshot({ path: path.join(process.cwd(), 'chatgpt-debug.png'), fullPage: true })
console.log('\nscreenshot →', path.join(process.cwd(), 'chatgpt-debug.png'))

await browser.close()