import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Configuration } from 'electron-builder'

const execFileAsync = promisify(execFile)
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const signScript = path.join(rootDir, 'scripts', 'sign-windows.ps1')

async function runPowerShell(args: string[]): Promise<void> {
  try {
    await execFileAsync('pwsh', args, { cwd: rootDir })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
    // pwsh (PowerShell 7) isn't installed — fall back to the Windows
    // PowerShell 5.1 that ships on every Windows machine. sign-windows.ps1
    // uses no PS7-only syntax, so this fallback is safe.
    await execFileAsync('powershell.exe', args, { cwd: rootDir })
  }
}

async function signWindows(configuration: { path: string }): Promise<void> {
  if (process.platform !== 'win32') return
  await runPowerShell(
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', signScript, configuration.path]
  )
}

const config: Configuration = {
  appId: 'com.meow.coding',
  productName: 'Meow Coding',
  publish: {
    provider: 'github',
    owner: 'stardust-bytes',
    repo: 'meow-coding'
  },
  icon: 'moew-coding-logo.png',
  directories: {
    output: 'release'
  },
  files: [
    'out/**/*',
    'package.json'
  ],
  extraResources: [
    { from: 'resources/skills', to: 'skills' },
    { from: 'out/browser-extension', to: 'browser-extension' },
    { from: 'resources/tray-icon.png', to: 'tray-icon.png' }
  ],
  asar: true,
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    signtoolOptions: {
      sign: signWindows,
      signingHashAlgorithms: ['sha256']
    }
  },
  nsis: {
    artifactName: 'Meow.Coding.Setup.${version}.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  portable: {
    artifactName: 'Meow.Coding.${version}.${ext}'
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    icon: 'build/icons',
    category: 'Development',
    maintainer: 'Meow Coding'
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    category: 'public.app-category.developer-tools',
    icon: 'moew-coding-logo.png'
  }
}

export default config
