import { describe, expect, it, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createOfficeTool, buildOfficeArgs } from '../../src/main/agent/tools/office'
import type { ToolContext } from '../../src/main/agent/tools/types'

let dir = ''
afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function ctx(): ToolContext {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-office-tool-'))
  return { cwd: dir, ask: async () => null }
}

function fakeChild(opts: { stdout?: string; stderr?: string; code?: number; never?: boolean }) {
  const child: any = new EventEmitter()
  child.pid = 1234
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  setTimeout(() => {
    if (opts.never) return
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    child.emit('close', opts.code ?? 0)
  }, 0)
  return child
}

describe('buildOfficeArgs', () => {
  it('appends --json when missing', () => {
    expect(buildOfficeArgs(['create', 'report.docx'])).toEqual(['create', 'report.docx', '--json'])
  })
  it('does not duplicate --json', () => {
    expect(buildOfficeArgs(['get', 'report.docx', '--json'])).toEqual(['get', 'report.docx', '--json'])
  })
})

describe('office tool', () => {
  it('spawns the resolved binary with args in ctx.cwd and returns stdout', async () => {
    let spawnCall: { bin: string; args: string[]; opts: { cwd: string } } | undefined
    const tool = createOfficeTool({
      resolveBinary: async () => '/fake/officecli',
      spawnFn: ((bin: string, args: string[], opts: { cwd: string }) => {
        spawnCall = { bin, args, opts }
        return fakeChild({ stdout: '{"success":true}' })
      }) as never
    })
    const r = await tool.run({ args: ['create', 'deck.pptx'] }, ctx())
    expect(r.output).toBe('{"success":true}')
    expect(spawnCall?.bin).toBe('/fake/officecli')
    expect(spawnCall?.args).toEqual(['create', 'deck.pptx', '--json'])
    expect(spawnCall?.opts.cwd).toBe(dir)
  })

  it('reports a nonzero exit with stdout and stderr', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => 'officecli',
      spawnFn: (() => fakeChild({
        stdout: '{"success":false,"error":{"code":"not_found"}}',
        stderr: 'boom',
        code: 1
      })) as never
    })
    const r = await tool.run({ args: ['get', 'x.docx', '/p[99]'] }, ctx())
    expect(r.error).toMatch(/exit code 1/)
    expect(r.error).toContain('not_found')
    expect(r.error).toContain('boom')
  })

  it('times out and kills the process tree', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => 'officecli',
      spawnFn: (() => fakeChild({ never: true })) as never
    })
    const r = await tool.run({ args: ['create', 'x.pptx'], timeoutMs: 100 }, ctx())
    expect(r.error).toMatch(/timeout/)
  }, 5000)

  it('returns a helpful error when the binary cannot be resolved', async () => {
    const tool = createOfficeTool({
      resolveBinary: async () => { throw new Error('officecli: download failed') }
    })
    const r = await tool.run({ args: ['create', 'x.docx'] }, ctx())
    expect(r.error).toMatch(/cannot locate officecli binary/)
  })

  it('rejects a missing args field', async () => {
    const tool = createOfficeTool({ resolveBinary: async () => 'officecli' })
    const r = await tool.run({}, ctx())
    expect(r.error).toMatch(/missing "args"/)
  })
})
