# Abort Kills Running Tool Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing Stop in the chat UI must kill the OS-level child process of any in-flight `bash` or `git` tool call immediately, instead of waiting for that process to exit on its own.

**Architecture:** Both `bashTool` and `gitTool` already receive an `AbortSignal` via `ToolContext.signal` (threaded from `AgentLoop.run(signal)` → `executeCall(call, signal)`), but neither tool listens to it — only their own internal timeouts kill the child process. This plan wires the existing signal into each tool's own process-kill path: `bash.ts` gets an `abort` listener that mirrors its existing timeout-kill branch (reusing the already-imported `tree-kill`), and `git.ts` passes the signal straight into Node's native `execFile({ signal })`, which kills the child itself.

**Tech Stack:** Node.js `child_process` (`spawn`, `execFile`), `tree-kill`, Vitest.

## Global Constraints

- Do not change existing success/timeout/error behavior for either tool — all current tests in `tests/unit/agent-tools-bash.test.ts` and `tests/unit/agent-tools-git.test.ts` must keep passing unmodified.
- Windows process-tree kill must go through `tree-kill` (already a dependency, already used correctly for this exact purpose in `src/main/pty-manager.ts`) — do not call `child.kill()` directly, it does not kill grandchild processes spawned by shell wrappers on Windows.
- No new dependencies.

---

### Task 1: `bash` tool kills its child process when the run is aborted

**Files:**
- Modify: `src/main/agent/tools/bash.ts:37-83` (the `run` method's Promise body)
- Test: `tests/unit/agent-tools-bash.test.ts`

**Interfaces:**
- Consumes: `ToolContext.signal?: AbortSignal` (already defined in `src/main/agent/tools/types.ts:19`) — no signature change.
- Produces: no new exports. Behavior change only: `bashTool.run` now resolves with `{ error: 'bash: aborted by user' }` (instead of hanging) when `ctx.signal` fires before the process exits.

- [ ] **Step 1: Write the failing test**

Add this test to the `describe('bash tool', ...)` block in `tests/unit/agent-tools-bash.test.ts`, right after the existing `'times out and kills the process tree'` test:

```ts
  it('kills the process when aborted mid-run', async () => {
    const controller = new AbortController()
    const cmd = process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1'
      : 'sleep 30'
    const start = Date.now()
    const run = bashTool.run({ command: cmd }, { cwd: dir, ask: async () => null, signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    const r = await run
    const elapsed = Date.now() - start
    expect(r.error).toMatch(/aborted/i)
    expect(elapsed).toBeLessThan(5000)
  }, 20000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-tools-bash.test.ts -t "kills the process when aborted mid-run"`
Expected: FAIL — the test times out at 20000ms (vitest's per-test timeout) because `bashTool.run` ignores `ctx.signal` and keeps waiting for the 30-second sleep/ping to finish naturally.

- [ ] **Step 3: Implement the abort listener in `bash.ts`**

Replace the body of the `run` method's returned Promise (`src/main/agent/tools/bash.ts:37-83`) with:

```ts
    return new Promise<ToolRunResult>(resolve => {
      const child = spawn(resolved.command, resolved.args, {
        cwd: fallbackCwd,
        env: process.env as Record<string, string>,
        windowsHide: true,
        windowsVerbatimArguments: resolved.verbatim ?? false
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let aborted = false

      const done = (result: ToolRunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid) {
          try {
            kill(child.pid, () => done({ error: `bash: timeout after ${timeoutMs}ms` }))
          } catch {
            done({ error: `bash: timeout after ${timeoutMs}ms` })
          }
        } else {
          done({ error: `bash: timeout after ${timeoutMs}ms` })
        }
      }, timeoutMs)
      const onAbort = () => {
        aborted = true
        if (child.pid) {
          try {
            kill(child.pid, () => done({ error: 'bash: aborted by user' }))
          } catch {
            done({ error: 'bash: aborted by user' })
          }
        } else {
          done({ error: 'bash: aborted by user' })
        }
      }
      if (ctx.signal) {
        if (ctx.signal.aborted) onAbort()
        else ctx.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString()
      })
      child.on('error', (err) => done({ error: `bash: ${err.message}` }))
      child.on('close', (code) => {
        if (timedOut || aborted) return
        const output = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
        const body = output || '(no output)'
        if (code === 0) return done({ output: note + body })
        done({ error: `bash: exit code ${code}\n${note}${output}` })
      })
    })
```

This mirrors the existing timeout-kill branch exactly, just triggered by `ctx.signal`'s `abort` event instead of `setTimeout`, and reuses the `kill` import (`tree-kill`) already at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-tools-bash.test.ts -t "kills the process when aborted mid-run"`
Expected: PASS — resolves in well under 5 seconds instead of running the full 30-second sleep/ping.

- [ ] **Step 5: Run the full bash tool test suite to confirm no regressions**

Run: `npx vitest run tests/unit/agent-tools-bash.test.ts`
Expected: All tests PASS, including the pre-existing timeout, exit-code, and cwd-fallback tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/bash.ts tests/unit/agent-tools-bash.test.ts
git commit -m "fix: bash tool kills child process when the agent turn is aborted"
```

---

### Task 2: `git` tool aborts its child process when the signal fires

**Files:**
- Modify: `src/main/agent/tools/git.ts`
- Test: `tests/unit/agent-tools-git.test.ts`

**Interfaces:**
- Consumes: `ToolContext.signal?: AbortSignal` — no signature change to the type.
- Produces: `runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<ToolRunResult>` — third parameter added, optional, so existing callers (if any outside this file) keep compiling. `gitTool.run` now passes `ctx.signal` through.

- [ ] **Step 1: Write the failing tests**

Add these three tests to the `describe('git tool', ...)` block in `tests/unit/agent-tools-git.test.ts`, after the existing `'does not ENOENT when the cwd is missing'` test:

```ts
  it('errors immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const r = await gitTool.run({ args: 'status' }, { ...ctx, signal: controller.signal })
    expect(r.error).toMatch(/aborted/i)
  })

  it('kills a running git command when aborted mid-run', async () => {
    execFileSync('git', ['config', 'alias.sleep', process.platform === 'win32'
      ? '!ping -n 30 127.0.0.1'
      : '!sleep 30'], { cwd: dir })
    const controller = new AbortController()
    const start = Date.now()
    const run = gitTool.run({ args: 'sleep' }, { ...ctx, signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    const r = await run
    const elapsed = Date.now() - start
    expect(r.error).toMatch(/aborted/i)
    expect(elapsed).toBeLessThan(5000)
  }, 20000)

  it('still runs normally when an unaborted signal is provided', async () => {
    const controller = new AbortController()
    const r = await gitTool.run({ args: 'status --porcelain' }, { ...ctx, signal: controller.signal })
    expect(r.output).toBe('(no output)')
  })
```

The `alias.sleep` trick creates a real slow-running child process through `git` itself (git resolves `!`-prefixed aliases by shelling out), which is the only reliable cross-platform way to prove the running git *process* actually gets killed rather than merely short-circuited before it starts.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-tools-git.test.ts -t "aborted"`
Expected: FAIL — `errors immediately when the signal is already aborted` fails because `gitTool.run` doesn't accept/use a signal at all (git command runs to completion and returns success, not an "aborted" error). `kills a running git command when aborted mid-run` times out at 20000ms waiting for the 30s ping/sleep alias to finish.

- [ ] **Step 3: Implement the signal pass-through in `git.ts`**

Replace the full contents of `src/main/agent/tools/git.ts` with:

```ts
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

export function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<ToolRunResult> {
  const resolvedCwd = existsSync(cwd) ? cwd : homedir()
  return new Promise(resolve => {
    let settled = false
    let aborted = false

    const child = execFile('git', args, {
      cwd: resolvedCwd,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim()
      if (aborted) return resolve({ error: 'git: aborted by user' })
      if (!err) return resolve({ output: out || '(no output)' })
      resolve({ error: `git ${args.join(' ')} failed:\n${out || err.message}` })
    })

    const onAbort = () => {
      aborted = true
      if (child.pid) {
        try {
          kill(child.pid, () => {
            if (!settled) {
              settled = true
              resolve({ error: 'git: aborted by user' })
            }
          })
        } catch {
          if (!settled) {
            settled = true
            resolve({ error: 'git: aborted by user' })
          }
        }
      } else {
        if (!settled) {
          settled = true
          resolve({ error: 'git: aborted by user' })
        }
      }
    }

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export const gitTool: ToolDefinition = {
  name: 'git',
  description:
    'Run a git command in the project directory (e.g. "diff", "status", "log --oneline -5", ' +
    '"commit -am msg", "revert", "stash"). Use for reviewing and committing changes.',
  schema: z.object({
    args: z.string().describe('The git arguments, e.g. "diff" or "log --oneline -5".')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { args } = input as unknown as { args: string }
    if (!args || typeof args !== 'string') return { error: 'git: missing "args"' }
    const argv = (args.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(a => a.replace(/^"|"$/g, ''))
    if (argv.length === 0) return { error: 'git: empty args' }
    return runGit(ctx.cwd, argv, ctx.signal)
  }
}
```

**Note (updated after Task 2's fix round):** the implementation above supersedes the `execFile({ signal })` + `err.code === 'ABORT_ERR'` approach originally described in this step. `execFile`'s built-in `signal` option only kills the immediate child process (`git` itself); it does not reach any subprocess `git` spawns (e.g. via a `!`-prefixed shell-out alias), which is exactly the scenario the "kills a running git command when aborted mid-run" test exercises. The fix round replaced it with a `tree-kill`-based approach matching `bash.ts`'s pattern, so the actual process tree (git and everything it spawned) gets killed on abort, not just the immediate `git` process.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-tools-git.test.ts`
Expected: All tests PASS, including the 3 new ones and all pre-existing ones (clean status, diff, log, failing command, missing args, missing cwd).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/git.ts tests/unit/agent-tools-git.test.ts
git commit -m "fix: git tool aborts its running process when the agent turn is stopped"
```

---

---

### Task 3: `bash` tool waits out Git Bash's startup fork before killing, so the real grandchild process is always caught

**Context (discovered during the final whole-branch review, not in the original spec):** the final review's re-review stress-tested Task 1's abort-kill and found it intermittently fails on Windows — roughly 40-50% of runs left an orphaned `ping.exe` alive after abort. Root-caused by direct reproduction (spawning `bash.exe -lc "ping -n 30 127.0.0.X"` and inspecting the live process tree via `Get-CimInstance Win32_Process`): Git Bash's `bash.exe` re-execs itself once before running the user's command, so the real process tree is **three levels deep** — `bash.exe` (the PID Node's `spawn()` returns) → a second `bash.exe` (re-exec'd) → the actual command (`ping.exe`) — not the two levels (`bash.exe` → command) the original fix assumed. `tree-kill`'s Windows implementation issues one `taskkill /pid <pid> /t /f`, which snapshots the process tree at the instant it runs; if the abort fires before the second `bash.exe` has finished forking the real command (verified to still be forming at ~300ms after spawn on this machine, but fully formed by ~500-800ms), the eventual grandchild is invisible to that snapshot and survives as an orphan, uncaught by the immediate parent's death.

**Files:**
- Modify: `src/main/agent/tools/bash.ts`
- Test: `tests/unit/agent-tools-bash.test.ts` (the existing `assertProcessGoneByMarker` helper added during the final-review fix wave — do not duplicate it, reuse it)

**Interfaces:**
- No signature changes. Behavior change only: the abort and timeout kill paths now wait out a fixed startup grace period (measured from spawn time) before issuing the kill, so the kill's process-tree snapshot is taken after Git Bash's re-exec has settled.

- [ ] **Step 1: Write the failing test**

The existing "kills the process when aborted mid-run" test (`tests/unit/agent-tools-bash.test.ts`, added in Task 1, strengthened in the final-review fix wave to use `assertProcessGoneByMarker`) already exercises this exact scenario and is the one that was observed failing intermittently. Do not write a new test — instead, run the existing one repeatedly to establish the current failure rate as your falsification baseline:

Run: `npx vitest run tests/unit/agent-tools-bash.test.ts -t "kills the process when aborted mid-run"` — repeat this command 10 times in a row (a shell loop is fine, e.g. `for i in $(seq 1 10); do npx vitest run tests/unit/agent-tools-bash.test.ts -t "kills the process when aborted mid-run" || echo "FAILED run $i"; done`).

- [ ] **Step 2: Confirm the baseline failure rate**

Expected: at least 2-3 of the 10 runs report `FAILED run N` (matching the ~40-50% rate found during the final review). If it happens to pass all 10 on this run, that's expected variance in a race condition, not proof the bug doesn't exist — proceed with the fix regardless, since the mechanism was already confirmed by direct process-tree inspection, not just by test flakiness.

- [ ] **Step 3: Implement the startup grace period in `bash.ts`**

Add a constant near the top of the file, after `MAX_OUTPUT`:

```ts
// Git Bash's bash.exe re-execs itself once before running the user's
// command, so the real process tree is bash.exe -> bash.exe -> command,
// not bash.exe -> command. tree-kill's single taskkill /t snapshot can
// miss the innermost command if it fires before that re-exec settles.
// Waiting this long (from spawn time) before killing ensures the full
// tree has formed. Empirically the re-exec settles within ~500ms.
const WINDOWS_KILL_GRACE_MS = 600
```

Then, in the `run` method, capture the spawn time and wrap both existing kill call sites (the timeout branch and the abort branch) so each waits out the remaining grace period before calling `kill`. Replace the body from `const child = spawn(...)` through the `if (ctx.signal) { ... }` block with:

```ts
      const child = spawn(resolved.command, resolved.args, {
        cwd: fallbackCwd,
        env: process.env as Record<string, string>,
        windowsHide: true,
        windowsVerbatimArguments: resolved.verbatim ?? false
      })
      const spawnedAt = Date.now()
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let aborted = false

      const done = (result: ToolRunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const killAfterGrace = (onDone: () => void) => {
        const remaining = process.platform === 'win32'
          ? WINDOWS_KILL_GRACE_MS - (Date.now() - spawnedAt)
          : 0
        const doKill = () => {
          if (child.pid) {
            try {
              kill(child.pid, onDone)
            } catch {
              onDone()
            }
          } else {
            onDone()
          }
        }
        if (remaining > 0) setTimeout(doKill, remaining)
        else doKill()
      }
      const timer = setTimeout(() => {
        timedOut = true
        killAfterGrace(() => done({ error: `bash: timeout after ${timeoutMs}ms` }))
      }, timeoutMs)
      const onAbort = () => {
        aborted = true
        killAfterGrace(() => done({ error: 'bash: aborted by user' }))
      }
      if (ctx.signal) {
        if (ctx.signal.aborted) onAbort()
        else ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
```

Note the grace period only applies on `win32` (`process.platform === 'win32'`). This is not because POSIX `tree-kill` uses process groups — it doesn't: looking at `node_modules/tree-kill/index.js`, the POSIX path enumerates descendants via `ps --ppid`/`pgrep -P` recursively and kills each PID individually, the same one-shot-snapshot shape as the Windows `taskkill /t` path. The real reason `bash.ts` only needs the grace period on Windows is that the re-exec/profile-load delay it's waiting out is specific to Git Bash: `bash -lc` is a login shell that sources `/etc/profile` and `~/.bash_profile` before re-execing into the user's command, and that profile-load step is what can push process-tree formation out past the snapshot. The POSIX path (`sh -c`) has no equivalent re-exec or profile-load step, so its process tree forms effectively instantaneously and a grace period would have nothing to wait out.

- [ ] **Step 4: Re-run the same test 10 times to verify the fix**

Run the same loop from Step 1: `for i in $(seq 1 10); do npx vitest run tests/unit/agent-tools-bash.test.ts -t "kills the process when aborted mid-run" || echo "FAILED run $i"; done`

Expected: 10/10 pass, 0 `FAILED` lines.

- [ ] **Step 5: Run the full bash and git tool suites together to confirm no regressions and no new flakiness**

Run this combined command 3 times: `npx vitest run tests/unit/agent-tools-bash.test.ts tests/unit/agent-tools-git.test.ts`

Expected: all tests pass in all 3 runs (both files' full suites, not just the abort tests — the grace period must not break the fast-exit or already-exited-quickly paths, e.g. the pre-existing "reports a nonzero exit as an error" test, which should still resolve promptly since it doesn't go through `killAfterGrace` at all).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/bash.ts
git commit -m "fix: bash tool waits out Git Bash's startup fork before killing on Windows"
```

---

## Manual verification (after all tasks)

These two tools are the only child-process-spawning tools reachable from a chat turn (`src/main/agent/tools/office.ts` and `src/main/agent/tools/webfetch.ts`/`websearch.ts` already correctly consume `ctx.signal`). After both tasks land:

1. `npm run dev` to launch the app.
2. Start a chat turn that runs a long `bash` command (e.g. ask the agent to run `sleep 30` or `ping -n 30 127.0.0.1`).
3. While it's running, click Stop.
4. Confirm the UI returns to idle within ~1 second, and confirm in Task Manager (Windows) that the spawned process (`ping.exe`/`bash.exe` child) is gone, not still running in the background.
