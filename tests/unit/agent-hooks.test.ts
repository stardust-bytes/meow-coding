import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HooksExecutor, loadProjectHooks, matchHook, mergeHooksConfig } from '../../src/main/agent/hooks'
import type { CommandHook, HookTraceRecord, HooksConfig, HttpHook, PromptHook } from '../../src/main/agent/hooks'
import type { LlmClient, LlmStreamOptions } from '../../src/main/agent/llm'
import { DEFAULT_MEOW_CONFIG, loadMeowConfig, settingsToConfig, configToSettings } from '../../src/main/agent/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-hooks-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('matchHook', () => {
  it('matches "*" and empty as catch-all', () => {
    expect(matchHook('*', 'Bash')).toBe(true)
    expect(matchHook('', 'anything')).toBe(true)
  })

  it('matches an exact tool name', () => {
    expect(matchHook('bash', 'bash')).toBe(true)
    expect(matchHook('bash', 'write')).toBe(false)
  })

  it('matches | and , separated lists', () => {
    expect(matchHook('edit|write', 'write')).toBe(true)
    expect(matchHook('edit, write', 'edit')).toBe(true)
    expect(matchHook('edit|write', 'read')).toBe(false)
  })

  it('treats anything else as an unanchored regex', () => {
    expect(matchHook('^mcp__', 'mcp__memory__read')).toBe(true)
    expect(matchHook('mcp__memory__.*', 'mcp__memory__write')).toBe(true)
    expect(matchHook('^mcp__', 'write')).toBe(false)
  })

  it('is case-sensitive and rejects a bad regex without throwing', () => {
    expect(matchHook('Write', 'write')).toBe(false)
    expect(matchHook('(', 'write')).toBe(false)
  })
})

describe('loadProjectHooks', () => {
  it('loads .meow/hooks.json when present', () => {
    mkdirSync(path.join(dir, '.meow'), { recursive: true })
    writeFileSync(
      path.join(dir, '.meow', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [{ matcher: 'edit|write', hooks: [{ type: 'command', command: 'check.sh' }] }]
      })
    )
    const cfg = loadProjectHooks(dir)
    expect(cfg.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'check.sh' })
  })

  it('returns {} when the file is missing', () => {
    expect(loadProjectHooks(dir)).toEqual({})
  })

  it('returns {} for malformed JSON instead of throwing', () => {
    mkdirSync(path.join(dir, '.meow'), { recursive: true })
    writeFileSync(path.join(dir, '.meow', 'hooks.json'), '{ not json')
    expect(loadProjectHooks(dir)).toEqual({})
  })
})

describe('mergeHooksConfig', () => {
  it('concatenates groups per event so both scopes run, global first', () => {
    const globalCfg: HooksConfig = {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'g.sh' }] }]
    }
    const projectCfg: HooksConfig = {
      PreToolUse: [{ matcher: 'write', hooks: [{ type: 'command', command: 'p.sh' }] }]
    }
    const merged = mergeHooksConfig(globalCfg, projectCfg)
    expect(merged.PreToolUse).toHaveLength(2)
    expect(merged.PreToolUse?.[0].hooks[0]).toMatchObject({ command: 'g.sh' })
    expect(merged.PreToolUse?.[1].hooks[0]).toMatchObject({ command: 'p.sh' })
  })

  it('drops events that no scope defines', () => {
    const merged = mergeHooksConfig(undefined, { Stop: [{ matcher: '*', hooks: [] }] })
    expect(merged.PreToolUse).toBeUndefined()
    expect(merged.PostToolUse).toBeUndefined()
    expect(merged.Stop).toHaveLength(1)
  })
})

describe('meow.json hooks key', () => {
  it('loads a hooks key from meow.json', () => {
    const file = path.join(dir, 'meow.json')
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x.sh' }] }] }
      })
    )
    const cfg = loadMeowConfig(file)
    expect(cfg.hooks?.PreToolUse?.[0].hooks[0]).toMatchObject({ type: 'command', command: 'x.sh' })
  })

  it('defaults to undefined hooks when absent', () => {
    expect(DEFAULT_MEOW_CONFIG.hooks).toBeUndefined()
    const file = path.join(dir, 'meow.json')
    writeFileSync(file, JSON.stringify({}))
    expect(loadMeowConfig(file).hooks).toBeUndefined()
  })

  it('drops empty event arrays so an empty hooks object normalizes away', () => {
    const file = path.join(dir, 'meow.json')
    writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [], Stop: [] } }))
    expect(loadMeowConfig(file).hooks).toBeUndefined()
  })

  // Hooks are file-edited, not a settings-UI field: saving settings must carry
  // them through from the base config instead of wiping them.
  it('preserves hooks through a settings round-trip', () => {
    const base = {
      ...DEFAULT_MEOW_CONFIG,
      hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command' as const, command: 'done.sh' }] }] }
    }
    const saved = settingsToConfig(configToSettings(base), base)
    expect(saved.hooks?.Stop?.[0].hooks[0]).toMatchObject({ command: 'done.sh' })
  })
})

// --- command execution -------------------------------------------------------

interface FakeScript {
  stdout?: string
  stderr?: string
  exitCode?: number
  // Never closes: lets a test drive the timeout path.
  keepOpen?: boolean
  spawnError?: string
}

interface SpawnRecord {
  command: string
  args: string[]
  options: Record<string, unknown>
  stdin: string
}

function fakeSpawn(script: FakeScript): { fn: (...a: never[]) => unknown; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = []
  const fn = (command: string, args: string[], options: Record<string, unknown>): unknown => {
    const record: SpawnRecord = { command, args, options, stdin: '' }
    calls.push(record)
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const handlers = new Map<string, (...a: unknown[]) => void>()
    return {
      pid: 4321,
      exitCode: null,
      signalCode: null,
      stdin: {
        end: (chunk?: string) => {
          record.stdin = chunk ?? ''
          if (script.keepOpen) return
          setTimeout(() => {
            if (script.spawnError) {
              handlers.get('error')?.(new Error(script.spawnError))
              return
            }
            if (script.stdout) stdout.emit('data', Buffer.from(script.stdout))
            if (script.stderr) stderr.emit('data', Buffer.from(script.stderr))
            handlers.get('close')?.(script.exitCode ?? 0)
          }, 0)
        }
      },
      stdout,
      stderr,
      on: (event: string, cb: (...a: unknown[]) => void) => {
        handlers.set(event, cb)
      },
      unref: () => {}
    }
  }
  return { fn: fn as never, calls }
}

const alwaysPre = (hook: Partial<CommandHook> = {}): HooksConfig => ({
  PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'gate.sh', ...hook } as CommandHook] }]
})

describe('HooksExecutor command execution', () => {
  it('writes the event payload to the child stdin', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    await ex.runPreToolUse('read', { file_path: 'a.ts' })
    expect(spawned.calls).toHaveLength(1)
    const payload = JSON.parse(spawned.calls[0].stdin)
    expect(payload).toMatchObject({
      hook_event_name: 'PreToolUse',
      cwd: '/proj',
      tool_name: 'read',
      tool_input: { file_path: 'a.ts' }
    })
  })

  it('treats exit 0 with non-JSON stdout as no decision', async () => {
    const spawned = fakeSpawn({ stdout: 'looks fine to me', exitCode: 0 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runPreToolUse('read', {})).toEqual({})
  })

  it('blocks on exit 2, using stderr as the reason when there is no JSON', async () => {
    const spawned = fakeSpawn({ stderr: 'forbidden path', exitCode: 2 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPreToolUse('write', { file_path: 'a.ts' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('forbidden path')
  })

  // Claude Code's documented footgun: only 2 blocks. Any other non-zero code is
  // a hook that failed, and a failed hook must not gate the tool.
  it('does not block on exit 1', async () => {
    const spawned = fakeSpawn({ stderr: 'boom', exitCode: 1 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect((await ex.runPreToolUse('write', {})).decision).toBeUndefined()
  })

  it('parses a hookSpecificOutput JSON body on exit 0', async () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'allow',
        permissionDecisionReason: 'allowlisted',
        additionalContext: 'production database',
        updatedInput: { file_path: 'b.ts' }
      }
    })
    const spawned = fakeSpawn({ stdout, exitCode: 0 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPreToolUse('write', { file_path: 'a.ts' })
    expect(r.decision).toBe('allow')
    expect(r.reason).toBe('allowlisted')
    expect(r.additionalContext).toBe('production database')
    expect(r.updatedInput).toEqual({ file_path: 'b.ts' })
  })

  it('ignores stdout that is not a bare JSON object', async () => {
    const noisy = 'note: {"hookSpecificOutput":{"permissionDecision":"deny"}}'
    const spawned = fakeSpawn({ stdout: noisy, exitCode: 0 })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })

  it('yields no decision when a hook times out, so the tool still proceeds', async () => {
    const spawned = fakeSpawn({ keepOpen: true })
    const killed: number[] = []
    const ex = new HooksExecutor(alwaysPre({ timeout: 0.01 }), {
      cwd: '/proj',
      spawnFn: spawned.fn as never,
      killFn: (pid, cb) => {
        killed.push(pid)
        cb()
      }
    })
    expect(await ex.runPreToolUse('read', {})).toEqual({})
    expect(killed).toEqual([4321])
  })

  it('yields no decision when the child fails to spawn', async () => {
    const spawned = fakeSpawn({ spawnError: 'ENOENT' })
    const ex = new HooksExecutor(alwaysPre(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runPreToolUse('read', {})).toEqual({})
  })

  it('runs an async hook fire-and-forget and never waits for a decision', async () => {
    const spawned = fakeSpawn({ exitCode: 2, keepOpen: true })
    const ex = new HooksExecutor(alwaysPre({ async: true }), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runPreToolUse('read', {})).toEqual({})
    expect(spawned.calls).toHaveLength(1)
  })

  it('uses the exec form verbatim when args are given, bypassing the shell', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(alwaysPre({ command: 'node', args: ['gate.js'] }), {
      cwd: '/proj',
      spawnFn: spawned.fn as never
    })
    await ex.runPreToolUse('read', {})
    expect(spawned.calls[0].command).toBe('node')
    expect(spawned.calls[0].args).toEqual(['gate.js'])
  })
})

// --- aggregation across hooks ------------------------------------------------

// One script per spawn, so a test can give each matching hook its own answer.
function fakeSpawnSeq(scripts: FakeScript[]): { fn: (...a: never[]) => unknown; calls: SpawnRecord[] } {
  const calls: SpawnRecord[] = []
  let index = 0
  const fn = (command: string, args: string[], options: Record<string, unknown>): unknown => {
    const script = scripts[Math.min(index++, scripts.length - 1)]
    const single = fakeSpawn(script)
    const child = (single.fn as unknown as (c: string, a: string[], o: Record<string, unknown>) => unknown)(
      command,
      args,
      options
    )
    calls.push(single.calls[0])
    return child
  }
  return { fn: fn as never, calls }
}

const decisionJson = (decision: string, reason?: string): string =>
  JSON.stringify({ hookSpecificOutput: { permissionDecision: decision, permissionDecisionReason: reason } })

const twoPreHooks: HooksConfig = {
  PreToolUse: [
    { matcher: '*', hooks: [{ type: 'command', command: 'a.sh' }] },
    { matcher: 'write', hooks: [{ type: 'command', command: 'b.sh' }] }
  ]
}

describe('HooksExecutor PreToolUse aggregation', () => {
  it('runs every matching group and lets deny beat a prior allow', async () => {
    const spawned = fakeSpawnSeq([
      { stdout: decisionJson('allow', 'fine'), exitCode: 0 },
      { stdout: decisionJson('deny', 'policy'), exitCode: 0 }
    ])
    const ex = new HooksExecutor(twoPreHooks, { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPreToolUse('write', {})
    expect(spawned.calls).toHaveLength(2)
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('policy')
  })

  it('keeps deny when a later hook only allows', async () => {
    const spawned = fakeSpawnSeq([
      { stdout: decisionJson('deny', 'policy'), exitCode: 0 },
      { stdout: decisionJson('allow', 'fine'), exitCode: 0 }
    ])
    const ex = new HooksExecutor(twoPreHooks, { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPreToolUse('write', {})
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('policy')
  })

  it('lets ask beat allow but lose to deny', async () => {
    const spawned = fakeSpawnSeq([
      { stdout: decisionJson('allow'), exitCode: 0 },
      { stdout: decisionJson('ask', 'confirm please'), exitCode: 0 }
    ])
    const ex = new HooksExecutor(twoPreHooks, { cwd: '/proj', spawnFn: spawned.fn as never })
    expect((await ex.runPreToolUse('write', {})).decision).toBe('ask')
  })

  it('skips groups whose matcher does not match the tool', async () => {
    const spawned = fakeSpawnSeq([{ exitCode: 0 }])
    const ex = new HooksExecutor(twoPreHooks, { cwd: '/proj', spawnFn: spawned.fn as never })
    await ex.runPreToolUse('read', {})
    expect(spawned.calls).toHaveLength(1)
  })

  it('concatenates additionalContext from every hook', async () => {
    const ctx = (text: string): string => JSON.stringify({ hookSpecificOutput: { additionalContext: text } })
    const spawned = fakeSpawnSeq([
      { stdout: ctx('first note'), exitCode: 0 },
      { stdout: ctx('second note'), exitCode: 0 }
    ])
    const ex = new HooksExecutor(twoPreHooks, { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPreToolUse('write', {})
    expect(r.additionalContext).toBe('first note\nsecond note')
  })
})

describe('HooksExecutor PostToolUse', () => {
  const postConfig = (): HooksConfig => ({
    PostToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'audit.sh' }] }]
  })

  it('sends the tool response in the payload', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(postConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    await ex.runPostToolUse('bash', { command: 'ls' }, { output: 'a.ts' })
    const payload = JSON.parse(spawned.calls[0].stdin)
    expect(payload).toMatchObject({
      hook_event_name: 'PostToolUse',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
      tool_response: { output: 'a.ts' }
    })
  })

  it('replaces the output via updatedToolOutput and appends additionalContext', async () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: { updatedToolOutput: 'REDACTED', additionalContext: 'secret scrubbed' }
    })
    const spawned = fakeSpawn({ stdout, exitCode: 0 })
    const ex = new HooksExecutor(postConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPostToolUse('bash', { command: 'ls' }, { output: 'AKIA-SECRET' })
    expect(r.updatedToolOutput).toBe('REDACTED')
    expect(r.additionalContext).toBe('secret scrubbed')
  })

  it('surfaces exit-2 stderr as a warning the model can read', async () => {
    const spawned = fakeSpawn({ stderr: 'lint failed', exitCode: 2 })
    const ex = new HooksExecutor(postConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runPostToolUse('bash', { command: 'ls' }, { output: 'ok' })
    expect(r.warning).toContain('lint failed')
  })

  it('does not run for a tool the matcher misses', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(postConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runPostToolUse('read', {}, { output: 'x' })).toEqual({})
    expect(spawned.calls).toHaveLength(0)
  })
})

describe('HooksExecutor Stop', () => {
  const stopConfig = (): HooksConfig => ({
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'verify.sh' }] }]
  })

  it('does not block on exit 0', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(stopConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runStop('all done', false)).toEqual({ block: false })
  })

  it('blocks on exit 2 and uses stderr as the reason', async () => {
    const spawned = fakeSpawn({ stderr: 'tests still failing', exitCode: 2 })
    const ex = new HooksExecutor(stopConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runStop('all done', false)
    expect(r.block).toBe(true)
    expect(r.reason).toContain('tests still failing')
  })

  it('blocks on a decision:"block" JSON body', async () => {
    const spawned = fakeSpawn({ stdout: JSON.stringify({ decision: 'block', reason: 'more work' }), exitCode: 0 })
    const ex = new HooksExecutor(stopConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    expect(await ex.runStop('all done', false)).toEqual({ block: true, reason: 'more work' })
  })

  it('sends stop_hook_active and the last assistant message', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor(stopConfig(), { cwd: '/proj', spawnFn: spawned.fn as never })
    await ex.runStop('all done', true)
    const payload = JSON.parse(spawned.calls[0].stdin)
    expect(payload).toMatchObject({
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'all done'
    })
  })

  it('stops at the first blocking hook instead of running the rest', async () => {
    const spawned = fakeSpawnSeq([{ stderr: 'blocked', exitCode: 2 }, { exitCode: 0 }])
    const ex = new HooksExecutor(
      {
        Stop: [
          { matcher: '*', hooks: [{ type: 'command', command: 'a.sh' }] },
          { matcher: '*', hooks: [{ type: 'command', command: 'b.sh' }] }
        ]
      },
      { cwd: '/proj', spawnFn: spawned.fn as never }
    )
    expect((await ex.runStop('done', false)).block).toBe(true)
    expect(spawned.calls).toHaveLength(1)
  })
})

describe('HooksExecutor mcp_tool handler', () => {
  const mcpPre = (): HooksConfig => ({
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'mcp_tool', server: 'policy', tool: 'check' }] }]
  })

  it('calls the MCP tool with the hook input merged under the event payload', async () => {
    const seen: { server: string; tool: string; input: Record<string, unknown> }[] = []
    const ex = new HooksExecutor(
      { PreToolUse: [{ matcher: '*', hooks: [{ type: 'mcp_tool', server: 'policy', tool: 'check', input: { strict: true } }] }] },
      {
        cwd: '/proj',
        callMcpTool: async (server, tool, input) => {
          seen.push({ server, tool, input })
          return { output: '' }
        }
      }
    )
    await ex.runPreToolUse('write', { file_path: 'a.ts' })
    expect(seen).toHaveLength(1)
    expect(seen[0].server).toBe('policy')
    expect(seen[0].tool).toBe('check')
    expect(seen[0].input).toMatchObject({ strict: true, tool_name: 'write', hook_event_name: 'PreToolUse' })
  })

  it('reads a decision out of the MCP tool output', async () => {
    const ex = new HooksExecutor(mcpPre(), {
      cwd: '/proj',
      callMcpTool: async () => ({ output: decisionJson('deny', 'mcp says no') })
    })
    const r = await ex.runPreToolUse('write', {})
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('mcp says no')
  })

  it('treats an MCP error as a block, the way exit 2 is', async () => {
    const ex = new HooksExecutor(mcpPre(), {
      cwd: '/proj',
      callMcpTool: async () => ({ error: 'server not connected' })
    })
    const r = await ex.runPreToolUse('write', {})
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('server not connected')
  })

  it('yields no decision when no MCP bridge is wired', async () => {
    const ex = new HooksExecutor(mcpPre(), { cwd: '/proj' })
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })
})

describe('HooksExecutor http handler', () => {
  const httpPre = (hook: Partial<HttpHook> = {}): HooksConfig => ({
    PreToolUse: [
      { matcher: '*', hooks: [{ type: 'http', url: 'https://policy.test/check', ...hook } as HttpHook] }
    ]
  })

  it('posts the event payload as JSON and reads the decision from the body', async () => {
    const seen: { url: string; init: Record<string, unknown> }[] = []
    const ex = new HooksExecutor(httpPre(), {
      cwd: '/proj',
      fetchFn: async (url: string, init: Record<string, unknown>) => {
        seen.push({ url, init })
        return { ok: true, status: 200, text: async () => decisionJson('ask', 'confirm') }
      }
    } as never)
    const r = await ex.runPreToolUse('write', { file_path: 'a.ts' })
    expect(seen[0].url).toBe('https://policy.test/check')
    expect(seen[0].init.method).toBe('POST')
    expect(JSON.parse(seen[0].init.body as string)).toMatchObject({ tool_name: 'write' })
    expect(r.decision).toBe('ask')
    expect(r.reason).toBe('confirm')
  })

  it('interpolates only allowlisted env vars into the url and headers', async () => {
    process.env.MEOW_TEST_HOOK_TOKEN = 'tok'
    process.env.MEOW_TEST_HOOK_SECRET = 'leak'
    try {
      const seen: { url: string; init: Record<string, unknown> }[] = []
      const ex = new HooksExecutor(
        httpPre({
          url: 'https://policy.test/$MEOW_TEST_HOOK_TOKEN',
          headers: { 'x-token': '$MEOW_TEST_HOOK_TOKEN', 'x-secret': '$MEOW_TEST_HOOK_SECRET' },
          allowedEnvVars: ['MEOW_TEST_HOOK_TOKEN']
        }),
        {
          cwd: '/proj',
          fetchFn: async (url: string, init: Record<string, unknown>) => {
            seen.push({ url, init })
            return { ok: true, status: 200, text: async () => '' }
          }
        } as never
      )
      await ex.runPreToolUse('write', {})
      expect(seen[0].url).toBe('https://policy.test/tok')
      const headers = seen[0].init.headers as Record<string, string>
      expect(headers['x-token']).toBe('tok')
      expect(headers['x-secret']).toBe('')
    } finally {
      delete process.env.MEOW_TEST_HOOK_TOKEN
      delete process.env.MEOW_TEST_HOOK_SECRET
    }
  })

  it('treats a non-2xx response as a block', async () => {
    const ex = new HooksExecutor(httpPre(), {
      cwd: '/proj',
      fetchFn: async () => ({ ok: false, status: 403, text: async () => 'denied by policy' })
    } as never)
    const r = await ex.runPreToolUse('write', {})
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('denied by policy')
  })

  it('yields no decision when the request throws', async () => {
    const ex = new HooksExecutor(httpPre(), {
      cwd: '/proj',
      fetchFn: async () => {
        throw new Error('ECONNREFUSED')
      }
    } as never)
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })
})

describe('HooksExecutor prompt handler', () => {
  // A hook model call is tool-less and single-shot: it inspects the event and
  // answers, so a text-only stub is the whole contract.
  function stubModel(text: string): { llm: LlmClient; model: string; seen: LlmStreamOptions[] } {
    const seen: LlmStreamOptions[] = []
    return {
      model: 'hook-model',
      seen,
      llm: {
        // eslint-disable-next-line require-yield
        async *stream(opts: LlmStreamOptions) {
          seen.push(opts)
          yield { kind: 'text' as const, text }
        }
      } as LlmClient
    }
  }

  const promptPre = (hook: Partial<PromptHook> = {}): HooksConfig => ({
    PreToolUse: [
      { matcher: '*', hooks: [{ type: 'prompt', prompt: 'Judge: $ARGUMENTS', ...hook } as PromptHook] }
    ]
  })

  it('substitutes $ARGUMENTS with the event payload and runs without tools', async () => {
    const stub = stubModel(decisionJson('deny', 'model says no'))
    const ex = new HooksExecutor(promptPre(), { cwd: '/proj', getModel: () => stub })
    const r = await ex.runPreToolUse('write', { file_path: 'a.ts' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toBe('model says no')
    const sent = stub.seen[0]
    expect(sent.tools).toEqual([])
    const userText = String(sent.messages[0].content)
    expect(userText).toContain('"tool_name":"write"')
    expect(userText).not.toContain('$ARGUMENTS')
  })

  it('uses the hook model override when one is set', async () => {
    const stub = stubModel('')
    const ex = new HooksExecutor(promptPre({ model: 'cheap-model' }), { cwd: '/proj', getModel: () => stub })
    await ex.runPreToolUse('write', {})
    expect(stub.seen[0].model).toBe('cheap-model')
  })

  it('treats a non-JSON answer as no decision', async () => {
    const stub = stubModel('Looks fine to me, carry on.')
    const ex = new HooksExecutor(promptPre(), { cwd: '/proj', getModel: () => stub })
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })

  it('yields no decision when no model is wired', async () => {
    const ex = new HooksExecutor(promptPre(), { cwd: '/proj' })
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })

  it('yields no decision when the model call throws', async () => {
    const llm: LlmClient = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('provider down')
      }
    }
    const ex = new HooksExecutor(promptPre(), { cwd: '/proj', getModel: () => ({ llm, model: 'm' }) })
    expect(await ex.runPreToolUse('write', {})).toEqual({})
  })

  it('lets an agent-type Stop hook block with {ok:false}', async () => {
    const stub = stubModel(JSON.stringify({ ok: false, reason: 'tests not run yet' }))
    const ex = new HooksExecutor(
      { Stop: [{ matcher: '*', hooks: [{ type: 'agent', prompt: 'Did it finish?' }] }] },
      { cwd: '/proj', getModel: () => stub }
    )
    expect(await ex.runStop('done', false)).toEqual({ block: true, reason: 'tests not run yet' })
  })
})

describe('HooksExecutor trace records', () => {
  it('reports started then a terminal status for each hook', async () => {
    const records: HookTraceRecord[] = []
    const spawned = fakeSpawn({ stderr: 'no', exitCode: 2 })
    const ex = new HooksExecutor(alwaysPre(), {
      cwd: '/proj',
      spawnFn: spawned.fn as never,
      onTrace: r => records.push(r)
    })
    await ex.runPreToolUse('write', {})
    expect(records.map(r => r.status)).toEqual(['started', 'blocked'])
    expect(records[1]).toMatchObject({ event: 'PreToolUse', tool: 'write' })
    expect(typeof records[1].durationMs).toBe('number')
  })
})
