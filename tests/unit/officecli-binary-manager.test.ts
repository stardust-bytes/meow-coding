import { describe, expect, it, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  officecliAssetFor,
  officecliBinaryFileName,
  findInPath,
  OfficeCliBinary,
  type FetchedResponse
} from '../../src/main/officecli/binary-manager'

let dir = ''

function makeDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-officecli-'))
  return dir
}

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function res(url: string, body: string | Buffer, ok = true, status = 200): FetchedResponse {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return {
    url,
    ok,
    status,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    text: async () => buf.toString()
  }
}

function makeFetch(handlers: Record<string, (url: string) => FetchedResponse>) {
  return async (url: string): Promise<FetchedResponse> => {
    const h = handlers[url]
    if (!h) throw new Error(`unexpected fetch: ${url}`)
    return h()
  }
}

const VERSION_URL = 'https://d.officecli.ai/releases/latest'
const ASSET_NAME = 'officecli-win-x64.exe'
const ASSET_URL = `https://d.officecli.ai/releases/download/v1.2.3/${ASSET_NAME}`
const SUMS_URL = `https://d.officecli.ai/releases/download/v1.2.3/SHA256SUMS`
const BINARY_BYTES = Buffer.from('fake-officecli-binary')
const SUMS_LINE = (bytes: Buffer, name: string) => {
  const hex = createHash('sha256').update(bytes).digest('hex')
  return `${hex}  ${name}\n`
}

describe('officecliAssetFor', () => {
  it('maps known platform/arch to asset names', () => {
    expect(officecliAssetFor('win32', 'x64')).toBe('officecli-win-x64.exe')
    expect(officecliAssetFor('win32', 'arm64')).toBe('officecli-win-arm64.exe')
    expect(officecliAssetFor('darwin', 'x64')).toBe('officecli-mac-x64')
    expect(officecliAssetFor('darwin', 'arm64')).toBe('officecli-mac-arm64')
    expect(officecliAssetFor('linux', 'x64')).toBe('officecli-linux-x64')
    expect(officecliAssetFor('linux', 'arm64')).toBe('officecli-linux-arm64')
  })

  it('returns null for unsupported platforms', () => {
    expect(officecliAssetFor('freebsd', 'x64')).toBeNull()
    expect(officecliAssetFor('win32', 'mips')).toBeNull()
  })
})

describe('officecliBinaryFileName', () => {
  it('uses .exe on win32', () => {
    expect(officecliBinaryFileName('win32')).toBe('officecli.exe')
    expect(officecliBinaryFileName('linux')).toBe('officecli')
    expect(officecliBinaryFileName('darwin')).toBe('officecli')
  })
})

describe('findInPath', () => {
  it('finds an existing executable in PATH', () => {
    const dir = makeDir()
    const name = officecliBinaryFileName(process.platform)
    writeFileSync(path.join(dir, name), 'x')
    const env: NodeJS.ProcessEnv = { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT' }
    const found = findInPath('officecli', env)
    expect(found).toBe(path.join(dir, name))
  })

  it('returns null when not present', () => {
    expect(findInPath('officecli', { PATH: makeDir() })).toBeNull()
  })
})

describe('OfficeCliBinary.resolveBinaryPath', () => {
  it('returns a binary found in PATH without downloading', async () => {
    const dir = makeDir()
    const name = officecliBinaryFileName(process.platform)
    writeFileSync(path.join(dir, name), 'x')
    const fetchFn = () => { throw new Error('should not fetch') }
    const bin = new OfficeCliBinary({ userDataDir: dir, env: { PATH: dir }, fetchFn: fetchFn as never })
    expect(await bin.resolveBinaryPath()).toBe(path.join(dir, name))
  })

  it('returns a local binary under userData/officecli without downloading', async () => {
    const dir = makeDir()
    const binDir = path.join(dir, 'officecli')
    const localPath = path.join(binDir, officecliBinaryFileName('win32'))
    mkdirSync(binDir, { recursive: true })
    writeFileSync(localPath, 'local')
    const fetchFn = () => { throw new Error('should not fetch') }
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', fetchFn: fetchFn as never })
    expect(await bin.resolveBinaryPath()).toBe(localPath)
  })

  it('downloads, verifies checksum and writes the binary', async () => {
    const dir = makeDir()
    const fetchFn = makeFetch({
      [VERSION_URL]: () => res('https://d.officecli.ai/releases/tag/v1.2.3', ''),
      [ASSET_URL]: () => res(ASSET_URL, BINARY_BYTES),
      [SUMS_URL]: () => res(SUMS_URL, SUMS_LINE(BINARY_BYTES, ASSET_NAME))
    })
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    const resolved = await bin.resolveBinaryPath()
    const localPath = path.join(dir, 'officecli', 'officecli.exe')
    expect(resolved).toBe(localPath)
    expect(existsSync(localPath)).toBe(true)
    expect(readFileSync(localPath)).toEqual(BINARY_BYTES)
  })

  it('throws and keeps no binary when checksum mismatches', async () => {
    const dir = makeDir()
    const fetchFn = makeFetch({
      [VERSION_URL]: () => res('https://d.officecli.ai/releases/tag/v1.2.3', ''),
      [ASSET_URL]: () => res(ASSET_URL, BINARY_BYTES),
      [SUMS_URL]: () => res(SUMS_URL, '0000000000000000000000000000000000000000000000000000000000000000  officecli-win-x64.exe\n')
    })
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    await expect(bin.resolveBinaryPath()).rejects.toThrow()
    expect(existsSync(path.join(dir, 'officecli', 'officecli.exe'))).toBe(false)
  })

  it('fails when no version can be resolved', async () => {
    const dir = makeDir()
    const fetchFn = async (url: string) => {
      if (url === VERSION_URL) return res('https://d.officecli.ai/somewhere', '', false, 404)
      throw new Error(`unexpected fetch: ${url}`)
    }
    const bin = new OfficeCliBinary({ userDataDir: dir, platform: 'win32', arch: 'x64', fetchFn })
    await expect(bin.resolveBinaryPath()).rejects.toThrow(/version/)
  })
})
