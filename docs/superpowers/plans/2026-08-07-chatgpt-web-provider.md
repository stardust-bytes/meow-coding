# ChatGPT Web Session Provider (Experimental) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, opt-in "chatgpt-web" provider that lets the native `meow` agent chat and call tools through a real, logged-in ChatGPT web session (Playwright browser automation), without touching the behavior of the existing anthropic/google/openai-compatible providers.

**Architecture:** A new self-contained module `src/main/chatgpt-web/` owns everything specific to this mechanism (session persistence, browser automation, prompt compilation, response parsing). It exposes exactly one thing to the rest of the app: a `ChatGptWebLlmClient` that implements the existing `LlmClient` interface from `src/main/agent/llm.ts`. `meow-agent-manager.ts` gets a single new branch that constructs this client instead of `createLlm()` when `provider === 'chatgpt-web'`. `playwright-core` is only ever imported lazily (inside async functions), so the dependency has zero cost when the feature is off.

**Tech Stack:** TypeScript, `playwright-core` (browser automation, system Chrome — no bundled browser download), `turndown` (already a dependency, HTML→Markdown), Vitest for unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-chatgpt-web-provider-design.md` — every task below implements one numbered section of it.
- Do not modify `src/main/agent/llm.ts`, `src/main/agent/config.ts`, or `AgentConfig`/`MeowConfig` schemas. `provider` stays a free string; `'chatgpt-web'` is just a new valid value.
- The only edits to existing files are: `src/main/meow-agent-manager.ts` (one branch + one list append), `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/components/settings/SettingsDialog.tsx`, `tests/unit/ipc-contract.test.ts`, `package.json`.
- `playwright-core` goes in `dependencies` (runtime, not dev) but is only reachable via dynamic `import()` inside `src/main/chatgpt-web/browser-login.ts` and `src/main/chatgpt-web/browser-worker.ts`. No other file imports it, directly or transitively, at module load time.
- Feature defaults to **off** (`enabled: false`) and `defaultProvider` must never be auto-set to `'chatgpt-web'`.
- v1 scope: full tool-calling support via a prompt-based `tool_call` fenced-block protocol (parsed after the ChatGPT turn fully completes — see Task 7 note on why this plan does not attempt token-level streaming for this provider). No "full mode" MCP tunnel, no local HTTP server — everything runs in-process.

---

### Task 1: Add `playwright-core` dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `playwright-core` importable from any file in `src/main/chatgpt-web/`.

- [x] **Step 1: Add the dependency**

In `package.json`, inside `"dependencies"` (alphabetical position, next to `"marked"` / before `"react"` — match existing sort order), add:

```json
    "playwright-core": "^1.62.0",
```

- [x] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no errors.

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add playwright-core dependency for chatgpt-web provider"
```

---

### Task 2: Model catalog

**Files:**
- Create: `src/main/chatgpt-web/model-catalog.ts`
- Test: `tests/unit/chatgpt-web-model-catalog.test.ts`

**Interfaces:**
- Produces:
  - `export const CHATGPT_WEB_PROVIDER_ID = 'chatgpt-web'`
  - `export interface ChatGptWebEffortLevel { id: string; label: string; uiEffortIndex: number }`
  - `export const CHATGPT_WEB_EFFORT_LEVELS: ChatGptWebEffortLevel[]`
  - `export function getChatGptWebModelRefs(): ModelRef[]`
  - `export function resolveChatGptWebEffort(model: string): ChatGptWebEffortLevel | null`

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-model-catalog.test.ts
import { describe, expect, it } from 'vitest'
import {
  CHATGPT_WEB_PROVIDER_ID, CHATGPT_WEB_EFFORT_LEVELS, getChatGptWebModelRefs, resolveChatGptWebEffort
} from '../../src/main/chatgpt-web/model-catalog'

describe('chatgpt-web model catalog', () => {
  it('defines exactly 5 effort levels with unique ids and increasing uiEffortIndex', () => {
    expect(CHATGPT_WEB_EFFORT_LEVELS).toHaveLength(5)
    const ids = CHATGPT_WEB_EFFORT_LEVELS.map(e => e.id)
    expect(new Set(ids).size).toBe(5)
    expect(CHATGPT_WEB_EFFORT_LEVELS.map(e => e.uiEffortIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('returns one ModelRef per effort level under the chatgpt-web provider', () => {
    const refs = getChatGptWebModelRefs()
    expect(refs).toHaveLength(5)
    expect(refs.every(r => r.provider === CHATGPT_WEB_PROVIDER_ID)).toBe(true)
    expect(refs.map(r => r.model).sort()).toEqual(['high', 'light', 'medium', 'pro', 'xhigh'].sort())
  })

  it('resolves a known model id to its effort level', () => {
    const effort = resolveChatGptWebEffort('high')
    expect(effort?.uiEffortIndex).toBe(2)
  })

  it('returns null for an unknown model id', () => {
    expect(resolveChatGptWebEffort('nope')).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-model-catalog.test.ts`
Expected: FAIL — module `src/main/chatgpt-web/model-catalog` not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/model-catalog.ts
import type { ModelRef } from '../../shared/types'

export const CHATGPT_WEB_PROVIDER_ID = 'chatgpt-web'

export interface ChatGptWebEffortLevel {
  id: string
  label: string
  uiEffortIndex: number
}

// uiEffortIndex matches the position of the corresponding item in ChatGPT's
// composer effort/model menu (0 = fastest, 4 = highest quality). Reconfirm
// against the live menu in Task 7 — ChatGPT's own labels may drift.
export const CHATGPT_WEB_EFFORT_LEVELS: ChatGptWebEffortLevel[] = [
  { id: 'light', label: 'Instant', uiEffortIndex: 0 },
  { id: 'medium', label: 'Medium', uiEffortIndex: 1 },
  { id: 'high', label: 'High', uiEffortIndex: 2 },
  { id: 'xhigh', label: 'Extra High', uiEffortIndex: 3 },
  { id: 'pro', label: 'Pro', uiEffortIndex: 4 }
]

export function getChatGptWebModelRefs(): ModelRef[] {
  return CHATGPT_WEB_EFFORT_LEVELS.map(e => ({ provider: CHATGPT_WEB_PROVIDER_ID, model: e.id }))
}

export function resolveChatGptWebEffort(model: string): ChatGptWebEffortLevel | null {
  return CHATGPT_WEB_EFFORT_LEVELS.find(e => e.id === model) ?? null
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-model-catalog.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/model-catalog.ts tests/unit/chatgpt-web-model-catalog.test.ts
git commit -m "feat: add chatgpt-web model/effort catalog"
```

---

### Task 3: Session store (config + storageState paths + verified marker)

**Files:**
- Create: `src/main/chatgpt-web/session-store.ts`
- Test: `tests/unit/chatgpt-web-session-store.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface ChatGptWebConfig { enabled: boolean; chromeExecutablePath?: string }`
  - `export interface ChatGptWebVerifiedMarker { authenticated: boolean; verifiedAt: string }`
  - `export class ChatGptWebSessionStore { constructor(dir: string); loadConfig(): ChatGptWebConfig; saveConfig(cfg: ChatGptWebConfig): void; storageStatePath(): string; readVerifiedMarker(): ChatGptWebVerifiedMarker | null; writeVerifiedMarker(m: ChatGptWebVerifiedMarker): void; clearSession(): void }`
  - Used by Task 10 (`manager.ts`) and Task 7/8 (browser worker/login need `storageStatePath()`).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-session-store.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatGptWebSessionStore } from '../../src/main/chatgpt-web/session-store'

describe('ChatGptWebSessionStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'chatgpt-web-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('defaults to disabled with no chromeExecutablePath when no config file exists', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.loadConfig()).toEqual({ enabled: false, chromeExecutablePath: undefined })
  })

  it('round-trips saved config', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.saveConfig({ enabled: true, chromeExecutablePath: '/opt/chrome' })
    expect(store.loadConfig()).toEqual({ enabled: true, chromeExecutablePath: '/opt/chrome' })
  })

  it('exposes a storageStatePath inside the given dir', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.storageStatePath()).toBe(path.join(dir, 'storage-state.json'))
  })

  it('returns null verified marker when never logged in', () => {
    const store = new ChatGptWebSessionStore(dir)
    expect(store.readVerifiedMarker()).toBeNull()
  })

  it('round-trips the verified marker', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.writeVerifiedMarker({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    expect(store.readVerifiedMarker()).toEqual({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
  })

  it('clearSession removes the storage state and verified marker but keeps config', () => {
    const store = new ChatGptWebSessionStore(dir)
    store.saveConfig({ enabled: true })
    store.writeVerifiedMarker({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    store.clearSession()
    expect(store.readVerifiedMarker()).toBeNull()
    expect(existsSync(store.storageStatePath())).toBe(false)
    expect(store.loadConfig().enabled).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-session-store.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/session-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export interface ChatGptWebConfig {
  enabled: boolean
  chromeExecutablePath?: string
}

export interface ChatGptWebVerifiedMarker {
  authenticated: boolean
  verifiedAt: string
}

const DEFAULT_CONFIG: ChatGptWebConfig = { enabled: false, chromeExecutablePath: undefined }

export class ChatGptWebSessionStore {
  constructor(private readonly dir: string) {}

  private configPath(): string {
    return path.join(this.dir, 'config.json')
  }

  private verifiedPath(): string {
    return path.join(this.dir, 'storage-state.verified.json')
  }

  storageStatePath(): string {
    return path.join(this.dir, 'storage-state.json')
  }

  loadConfig(): ChatGptWebConfig {
    if (!existsSync(this.configPath())) return { ...DEFAULT_CONFIG }
    try {
      const parsed = JSON.parse(readFileSync(this.configPath(), 'utf-8'))
      return { enabled: Boolean(parsed.enabled), chromeExecutablePath: parsed.chromeExecutablePath || undefined }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  saveConfig(cfg: ChatGptWebConfig): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.configPath(), JSON.stringify(cfg, null, 2))
  }

  readVerifiedMarker(): ChatGptWebVerifiedMarker | null {
    if (!existsSync(this.verifiedPath())) return null
    try {
      return JSON.parse(readFileSync(this.verifiedPath(), 'utf-8'))
    } catch {
      return null
    }
  }

  writeVerifiedMarker(marker: ChatGptWebVerifiedMarker): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.verifiedPath(), JSON.stringify(marker, null, 2))
  }

  clearSession(): void {
    for (const p of [this.storageStatePath(), this.verifiedPath()]) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-session-store.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/session-store.ts tests/unit/chatgpt-web-session-store.test.ts
git commit -m "feat: add chatgpt-web session store (config + storage-state paths)"
```

---

### Task 4: Prompt compiler

**Files:**
- Create: `src/main/chatgpt-web/prompt.ts`
- Test: `tests/unit/chatgpt-web-prompt.test.ts`

**Interfaces:**
- Consumes: `LlmStreamOptions` from `src/main/agent/llm.ts` (already defined: `{ model, system, messages, tools, signal?, variantOptions? }`), `ToolDefinition` from `src/main/agent/tools/types`.
- Produces: `export const CHATGPT_WEB_TOOL_CALL_FENCE = 'tool_call'`, `export function compileChatGptWebPrompt(opts: Pick<LlmStreamOptions, 'system' | 'messages' | 'tools'>): string`. Used by Task 9 (`client.ts`).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-prompt.test.ts
import { describe, expect, it } from 'vitest'
import { compileChatGptWebPrompt, CHATGPT_WEB_TOOL_CALL_FENCE } from '../../src/main/chatgpt-web/prompt'
import type { ToolDefinition } from '../../src/main/agent/tools/types'

const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Run a shell command',
  inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  async run() { return { output: '' } }
} as unknown as ToolDefinition

describe('compileChatGptWebPrompt', () => {
  it('includes the system prompt verbatim', () => {
    const prompt = compileChatGptWebPrompt({ system: 'You are meow.', messages: [], tools: [] })
    expect(prompt).toContain('You are meow.')
  })

  it('includes the tool_call fenced-block protocol instructions', () => {
    const prompt = compileChatGptWebPrompt({ system: 'sys', messages: [], tools: [] })
    expect(prompt).toContain('```' + CHATGPT_WEB_TOOL_CALL_FENCE)
    expect(prompt.toLowerCase()).toContain('do not execute')
  })

  it('serializes tool name and description into the prompt', () => {
    const prompt = compileChatGptWebPrompt({ system: 'sys', messages: [], tools: [bashTool] })
    expect(prompt).toContain('"name": "bash"')
    expect(prompt).toContain('Run a shell command')
  })

  it('serializes message history as JSON', () => {
    const prompt = compileChatGptWebPrompt({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }] as never,
      tools: []
    })
    expect(prompt).toContain('"role": "user"')
    expect(prompt).toContain('hello')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-prompt.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/prompt.ts
import type { ModelMessage } from 'ai'
import type { ToolDefinition } from '../agent/tools/types'

export const CHATGPT_WEB_TOOL_CALL_FENCE = 'tool_call'

interface PromptInput {
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
}

function toolSummary(tools: ToolDefinition[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  }))
}

export function compileChatGptWebPrompt(opts: PromptInput): string {
  const toolsJson = JSON.stringify(toolSummary(opts.tools), null, 2)
  const messagesJson = JSON.stringify(opts.messages, null, 2)

  return [
    '# System',
    opts.system,
    '',
    '# Tools available to you',
    'You are acting as the LLM backend for a coding agent. The tools below are executed',
    'locally by the agent, not by you — you never run them yourself.',
    toolsJson,
    '',
    '# Conversation so far',
    messagesJson,
    '',
    '# How to respond',
    'Reply normally in Markdown for plain text/explanations.',
    `When you need to call a tool, output a fenced code block tagged \`${CHATGPT_WEB_TOOL_CALL_FENCE}\``,
    'containing a single JSON object with "name" and "input" keys, for example:',
    '```' + CHATGPT_WEB_TOOL_CALL_FENCE,
    '{"name": "bash", "input": {"command": "ls"}}',
    '```',
    'Do not execute the tool yourself and do not fabricate its result — the agent will run it',
    'and send you the real result in the next turn. Only include a tool_call block when you',
    'actually need to call a tool; otherwise just answer in plain text.'
  ].join('\n')
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-prompt.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/prompt.ts tests/unit/chatgpt-web-prompt.test.ts
git commit -m "feat: add chatgpt-web prompt compiler with tool_call protocol"
```

---

### Task 5: Response parser

**Files:**
- Create: `src/main/chatgpt-web/response-parser.ts`
- Test: `tests/unit/chatgpt-web-response-parser.test.ts`

**Interfaces:**
- Consumes: `LlmStreamPart` from `src/main/agent/llm.ts`, `CHATGPT_WEB_TOOL_CALL_FENCE` from Task 4.
- Produces: `export function parseChatGptWebResponse(markdown: string): LlmStreamPart[]`. Used by Task 9 (`client.ts`).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-response-parser.test.ts
import { describe, expect, it } from 'vitest'
import { parseChatGptWebResponse } from '../../src/main/chatgpt-web/response-parser'

describe('parseChatGptWebResponse', () => {
  it('returns a single text part for plain markdown', () => {
    const parts = parseChatGptWebResponse('Hello, this is plain text.')
    expect(parts).toEqual([{ kind: 'text', text: 'Hello, this is plain text.' }])
  })

  it('extracts a tool_call block into a tool-call part', () => {
    const md = 'Sure, let me check.\n\n```tool_call\n{"name": "bash", "input": {"command": "ls"}}\n```\n'
    const parts = parseChatGptWebResponse(md)
    expect(parts[0]).toEqual({ kind: 'text', text: 'Sure, let me check.' })
    expect(parts[1].kind).toBe('tool-call')
    expect(parts[1].toolName).toBe('bash')
    expect(parts[1].toolInput).toEqual({ command: 'ls' })
    expect(typeof parts[1].toolCallId).toBe('string')
    expect(parts[1].toolCallId!.length).toBeGreaterThan(0)
  })

  it('supports multiple tool_call blocks interleaved with text', () => {
    const md = [
      'First I will read the file.',
      '```tool_call',
      '{"name": "read", "input": {"path": "a.txt"}}',
      '```',
      'Now let me check another one.',
      '```tool_call',
      '{"name": "read", "input": {"path": "b.txt"}}',
      '```'
    ].join('\n')
    const parts = parseChatGptWebResponse(md)
    const toolParts = parts.filter(p => p.kind === 'tool-call')
    expect(toolParts).toHaveLength(2)
    expect(toolParts[0].toolInput).toEqual({ path: 'a.txt' })
    expect(toolParts[1].toolInput).toEqual({ path: 'b.txt' })
  })

  it('falls back to treating an unparseable tool_call block as plain text', () => {
    const md = 'Oops:\n```tool_call\nnot valid json\n```'
    const parts = parseChatGptWebResponse(md)
    expect(parts.some(p => p.kind === 'tool-call')).toBe(false)
    expect(parts.map(p => p.text).join('')).toContain('not valid json')
  })

  it('returns an empty array for empty input', () => {
    expect(parseChatGptWebResponse('')).toEqual([])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-response-parser.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/response-parser.ts
import { randomUUID } from 'node:crypto'
import type { LlmStreamPart } from '../agent/llm'
import { CHATGPT_WEB_TOOL_CALL_FENCE } from './prompt'

const FENCE_RE = new RegExp('```' + CHATGPT_WEB_TOOL_CALL_FENCE + '\\n([\\s\\S]*?)\\n```', 'g')

export function parseChatGptWebResponse(markdown: string): LlmStreamPart[] {
  if (!markdown.trim()) return []

  const parts: LlmStreamPart[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  FENCE_RE.lastIndex = 0
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    const before = markdown.slice(cursor, match.index).trim()
    const body = match[1]
    let parsed: { name?: string; input?: Record<string, unknown> } | null = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }

    if (parsed && typeof parsed.name === 'string') {
      if (before) parts.push({ kind: 'text', text: before })
      parts.push({
        kind: 'tool-call',
        toolName: parsed.name,
        toolCallId: randomUUID(),
        toolInput: parsed.input ?? {}
      })
    } else {
      // Not a valid tool_call payload — keep the whole fenced block as text
      // instead of throwing the turn away.
      const raw = markdown.slice(cursor, FENCE_RE.lastIndex).trim()
      if (raw) parts.push({ kind: 'text', text: raw })
    }
    cursor = FENCE_RE.lastIndex
  }

  const rest = markdown.slice(cursor).trim()
  if (rest) parts.push({ kind: 'text', text: rest })

  return parts
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-response-parser.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/response-parser.ts tests/unit/chatgpt-web-response-parser.test.ts
git commit -m "feat: add chatgpt-web response parser (text + tool_call blocks)"
```

---

### Task 6: Tab concurrency limiter + turn-state pure helpers

**Files:**
- Create: `src/main/chatgpt-web/turn-state.ts`
- Test: `tests/unit/chatgpt-web-turn-state.test.ts`

**Interfaces:**
- Produces:
  - `export class ChatGptWebTabLimiter { constructor(max: number); acquire(): Promise<() => void>; get active(): number }`
  - `export interface ChatGptWebDomSnapshot { hasStopButton: boolean; hasCopyButton: boolean; textLength: number }`
  - `export function isChatGptWebTurnComplete(snapshot: ChatGptWebDomSnapshot): boolean`
  - `export function isChatGptWebRateLimitDialog(dialogText: string): boolean`
  - Used by Task 7 (`browser-worker.ts`).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-turn-state.test.ts
import { describe, expect, it } from 'vitest'
import {
  ChatGptWebTabLimiter, isChatGptWebTurnComplete, isChatGptWebRateLimitDialog
} from '../../src/main/chatgpt-web/turn-state'

describe('ChatGptWebTabLimiter', () => {
  it('allows up to `max` concurrent holders', async () => {
    const limiter = new ChatGptWebTabLimiter(2)
    const release1 = await limiter.acquire()
    const release2 = await limiter.acquire()
    expect(limiter.active).toBe(2)
    release1()
    release2()
  })

  it('queues a third acquire until a slot is released', async () => {
    const limiter = new ChatGptWebTabLimiter(1)
    const release1 = await limiter.acquire()
    let acquired = false
    const p = limiter.acquire().then(release => { acquired = true; release() })
    await new Promise(r => setTimeout(r, 10))
    expect(acquired).toBe(false)
    release1()
    await p
    expect(acquired).toBe(true)
  })
})

describe('isChatGptWebTurnComplete', () => {
  it('is false while the stop button is visible', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: true, hasCopyButton: false, textLength: 10 })).toBe(false)
  })

  it('is false when there is no text yet', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: false, hasCopyButton: true, textLength: 0 })).toBe(false)
  })

  it('is true once the stop button is gone, the copy button is visible, and there is text', () => {
    expect(isChatGptWebTurnComplete({ hasStopButton: false, hasCopyButton: true, textLength: 42 })).toBe(true)
  })
})

describe('isChatGptWebRateLimitDialog', () => {
  it('matches known ChatGPT rate-limit phrasing', () => {
    expect(isChatGptWebRateLimitDialog('You are sending messages too quickly. Please slow down.')).toBe(true)
    expect(isChatGptWebRateLimitDialog('Too many requests, try again later.')).toBe(true)
  })

  it('does not match unrelated dialog text', () => {
    expect(isChatGptWebRateLimitDialog('Allow ChatGPT to use the connector?')).toBe(false)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-turn-state.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/turn-state.ts
export class ChatGptWebTabLimiter {
  private activeCount = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  get active(): number {
    return this.activeCount
  }

  async acquire(): Promise<() => void> {
    if (this.activeCount >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.activeCount++
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeCount--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export interface ChatGptWebDomSnapshot {
  hasStopButton: boolean
  hasCopyButton: boolean
  textLength: number
}

export function isChatGptWebTurnComplete(snapshot: ChatGptWebDomSnapshot): boolean {
  return !snapshot.hasStopButton && snapshot.hasCopyButton && snapshot.textLength > 0
}

const RATE_LIMIT_PATTERNS = [/too (many|quickly)/i, /slow down/i, /try again later/i]

export function isChatGptWebRateLimitDialog(dialogText: string): boolean {
  return RATE_LIMIT_PATTERNS.some(re => re.test(dialogText))
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-turn-state.test.ts`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/turn-state.ts tests/unit/chatgpt-web-turn-state.test.ts
git commit -m "feat: add chatgpt-web tab limiter and turn-completion helpers"
```

---

### Task 7: Browser worker (Playwright turn execution)

**Files:**
- Create: `src/main/chatgpt-web/browser-worker.ts`
- Test: `tests/unit/chatgpt-web-browser-worker.test.ts`

**Interfaces:**
- Consumes: `ChatGptWebTabLimiter`, `isChatGptWebTurnComplete`, `isChatGptWebRateLimitDialog` from Task 6; `ChatGptWebEffortLevel` from Task 2.
- Produces:
  - `export interface ChatGptWebPage` (narrow interface — see below)
  - `export async function runChatGptWebTurn(page: ChatGptWebPage, prompt: string, effort: ChatGptWebEffortLevel, signal?: AbortSignal): Promise<string>` — returns final answer as Markdown.
  - `export function wrapPlaywrightPage(page: import('playwright-core').Page): ChatGptWebPage` — untested adapter, only reachable via dynamic import.
  - `export const CHATGPT_WEB_TAB_LIMITER: ChatGptWebTabLimiter` (shared singleton, max 3 — see spec §7).
  - Used by Task 9 (`client.ts`).

**Note on why this plan does not stream token-by-token for this provider:** ChatGPT's answer can contain a `tool_call` fenced block that must not leak into the visible chat transcript as raw JSON while it's still being typed out. Splitting/re-joining that block correctly across partial DOM snapshots is a real source of bugs for very little UX benefit here (this is an experimental, opt-in provider). v1 polls until the turn is complete, then does one parse pass (Task 5) over the full text. This is a deliberate scope cut, not an oversight — revisit only if users report chatgpt-web turns feel too silent.

- [x] **Step 1: Write the failing test (for the narrow-interface, DOM-independent logic only)**

```typescript
// tests/unit/chatgpt-web-browser-worker.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runChatGptWebTurn, type ChatGptWebPage } from '../../src/main/chatgpt-web/browser-worker'
import { CHATGPT_WEB_EFFORT_LEVELS } from '../../src/main/chatgpt-web/model-catalog'

function fakePage(opts: {
  snapshots: Array<{ hasStopButton: boolean; hasCopyButton: boolean; text: string }>
  dialogText?: string | null
}): ChatGptWebPage {
  let call = 0
  return {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    insertText: vi.fn(async () => {}),
    readDialogText: vi.fn(async () => opts.dialogText ?? null),
    readSnapshot: vi.fn(async () => {
      const snap = opts.snapshots[Math.min(call, opts.snapshots.length - 1)]
      call++
      return snap
    }),
    close: vi.fn(async () => {})
  }
}

describe('runChatGptWebTurn', () => {
  it('polls until complete and returns the final markdown', async () => {
    const page = fakePage({
      snapshots: [
        { hasStopButton: true, hasCopyButton: false, text: 'Thinking' },
        { hasStopButton: true, hasCopyButton: false, text: 'Thinking more' },
        { hasStopButton: false, hasCopyButton: true, text: 'Final answer' }
      ]
    })
    const result = await runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], undefined, { pollIntervalMs: 0 })
    expect(result).toBe('Final answer')
    expect(page.insertText).toHaveBeenCalledWith('hello')
    expect(page.close).toHaveBeenCalled()
  })

  it('throws a rate-limit error when the rate-limit dialog appears', async () => {
    const page = fakePage({
      snapshots: [{ hasStopButton: true, hasCopyButton: false, text: '' }],
      dialogText: 'You are sending messages too quickly.'
    })
    await expect(
      runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], undefined, { pollIntervalMs: 0 })
    ).rejects.toThrow(/rate.limit/i)
    expect(page.close).toHaveBeenCalled()
  })

  it('aborts and closes the page when the signal fires', async () => {
    const controller = new AbortController()
    controller.abort()
    const page = fakePage({ snapshots: [{ hasStopButton: true, hasCopyButton: false, text: '' }] })
    await expect(
      runChatGptWebTurn(page, 'hello', CHATGPT_WEB_EFFORT_LEVELS[0], controller.signal, { pollIntervalMs: 0 })
    ).rejects.toThrow(/abort/i)
    expect(page.close).toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-browser-worker.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

Selectors below are best-effort and MUST be confirmed live before this feature is used end-to-end: open `https://chatgpt.com/?temporary-chat=true` in a real Chrome, sign in, open DevTools → Elements, and inspect (a) the prompt textbox, (b) the send button, (c) the effort/model-picker trigger and its menu items, (d) the stop button, (e) the per-turn "copy" action button, (f) the rate-limit dialog container. Update the `SELECTORS` object below to match what you find — do this as part of running this task, before moving to Task 8.

```typescript
// src/main/chatgpt-web/browser-worker.ts
import { ChatGptWebTabLimiter, isChatGptWebTurnComplete, isChatGptWebRateLimitDialog } from './turn-state'
import type { ChatGptWebEffortLevel } from './model-catalog'

// CONFIRM LIVE against chatgpt.com before relying on this in production — see Task 7 note above.
export const SELECTORS = {
  composer: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  effortMenuTrigger: '[data-testid="model-switcher-dropdown-button"]',
  effortMenuItem: (index: number) => `[role="menuitemradio"]:nth-of-type(${index + 1})`,
  stopButton: '[data-testid="stop-button"]',
  copyButton: '[data-testid="copy-turn-action-button"]',
  answerRoot: '.markdown.prose:last-of-type',
  dialog: '[role="alertdialog"], [role="dialog"]'
}

export interface ChatGptWebPage {
  goto(url: string): Promise<void>
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<void>
  click(selector: string): Promise<void>
  insertText(text: string): Promise<void>
  readDialogText(): Promise<string | null>
  readSnapshot(): Promise<{ hasStopButton: boolean; hasCopyButton: boolean; text: string }>
  close(): Promise<void>
}

export const CHATGPT_WEB_TAB_LIMITER = new ChatGptWebTabLimiter(3)

export interface RunTurnOptions {
  pollIntervalMs?: number
  timeoutMs?: number
}

export async function runChatGptWebTurn(
  page: ChatGptWebPage,
  prompt: string,
  effort: ChatGptWebEffortLevel,
  signal?: AbortSignal,
  options: RunTurnOptions = {}
): Promise<string> {
  const pollIntervalMs = options.pollIntervalMs ?? 400
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  const deadline = Date.now() + timeoutMs

  try {
    if (signal?.aborted) throw new Error('aborted before turn started')

    await page.goto('https://chatgpt.com/?temporary-chat=true')
    await page.waitForSelector(SELECTORS.composer)
    await page.click(SELECTORS.effortMenuTrigger)
    await page.click(SELECTORS.effortMenuItem(effort.uiEffortIndex))
    await page.insertText(prompt)
    await page.click(SELECTORS.sendButton)

    while (true) {
      if (signal?.aborted) throw new Error('aborted during turn')
      if (Date.now() > deadline) throw new Error('chatgpt-web turn timed out')

      const dialogText = await page.readDialogText()
      if (dialogText && isChatGptWebRateLimitDialog(dialogText)) {
        throw new Error(`chatgpt-web rate limit: ${dialogText}`)
      }

      const snapshot = await page.readSnapshot()
      if (isChatGptWebTurnComplete({
        hasStopButton: snapshot.hasStopButton,
        hasCopyButton: snapshot.hasCopyButton,
        textLength: snapshot.text.length
      })) {
        return snapshot.text
      }

      if (pollIntervalMs > 0) await new Promise(r => setTimeout(r, pollIntervalMs))
    }
  } finally {
    await page.close()
  }
}

// Bridges a real Playwright Page to the narrow ChatGptWebPage interface above.
// Not unit tested (requires a live browser) — covered by the manual smoke test
// in Task 14.
export function wrapPlaywrightPage(page: import('playwright-core').Page): ChatGptWebPage {
  return {
    goto: url => page.goto(url).then(() => undefined),
    waitForSelector: (selector, opts) => page.waitForSelector(selector, opts).then(() => undefined),
    click: selector => page.click(selector),
    insertText: text => page.keyboard.insertText(text),
    readDialogText: () => page.locator(SELECTORS.dialog).first().textContent(),
    readSnapshot: async () => ({
      hasStopButton: await page.locator(SELECTORS.stopButton).count() > 0,
      hasCopyButton: await page.locator(SELECTORS.copyButton).count() > 0,
      text: await page.locator(SELECTORS.answerRoot).last().innerHTML().catch(() => '')
    }),
    close: () => page.close()
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-browser-worker.test.ts`
Expected: PASS (3 tests). `wrapPlaywrightPage` is not covered by this test (it needs a real Playwright `Page`); that's expected per the spec's testing plan (§9).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/browser-worker.ts tests/unit/chatgpt-web-browser-worker.test.ts
git commit -m "feat: add chatgpt-web browser worker turn execution"
```

---

### Task 8: Browser login

**Files:**
- Create: `src/main/chatgpt-web/browser-login.ts`
- Test: `tests/unit/chatgpt-web-browser-login.test.ts`

**Interfaces:**
- Consumes: `ChatGptWebSessionStore` from Task 3.
- Produces:
  - `export function resolveChromeExecutablePath(opts: { override?: string; platform: NodeJS.Platform; exists: (p: string) => boolean }): string | null`
  - `export async function loginToChatGptWeb(store: ChatGptWebSessionStore): Promise<{ authenticated: boolean; verifiedAt: string }>` — not unit tested (opens a real browser); see Task 14 for the manual smoke test.

- [x] **Step 1: Write the failing test (pure resolver only)**

```typescript
// tests/unit/chatgpt-web-browser-login.test.ts
import { describe, expect, it } from 'vitest'
import { resolveChromeExecutablePath } from '../../src/main/chatgpt-web/browser-login'

describe('resolveChromeExecutablePath', () => {
  it('prefers an explicit override if it exists', () => {
    const result = resolveChromeExecutablePath({
      override: '/custom/chrome',
      platform: 'linux',
      exists: p => p === '/custom/chrome'
    })
    expect(result).toBe('/custom/chrome')
  })

  it('ignores an override that does not exist and falls back to platform defaults', () => {
    const result = resolveChromeExecutablePath({
      override: '/missing/chrome',
      platform: 'linux',
      exists: p => p === '/usr/bin/google-chrome'
    })
    expect(result).toBe('/usr/bin/google-chrome')
  })

  it('checks Windows default install paths', () => {
    const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    const result = resolveChromeExecutablePath({
      platform: 'win32',
      exists: p => p === winPath
    })
    expect(result).toBe(winPath)
  })

  it('checks macOS default install path', () => {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const result = resolveChromeExecutablePath({
      platform: 'darwin',
      exists: p => p === macPath
    })
    expect(result).toBe(macPath)
  })

  it('returns null when nothing is found', () => {
    const result = resolveChromeExecutablePath({ platform: 'linux', exists: () => false })
    expect(result).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-browser-login.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/browser-login.ts
import type { ChatGptWebSessionStore } from './session-store'

interface ResolveChromeOpts {
  override?: string
  platform: NodeJS.Platform
  exists: (p: string) => boolean
}

const DEFAULT_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

export function resolveChromeExecutablePath(opts: ResolveChromeOpts): string | null {
  if (opts.override && opts.exists(opts.override)) return opts.override
  const candidates = DEFAULT_PATHS[opts.platform] ?? []
  return candidates.find(opts.exists) ?? null
}

// Opens a real, visible Chrome window for the user to log into chatgpt.com
// manually (CAPTCHA/2FA cannot be automated), then persists the session.
// Requires a live browser — verified via the manual smoke test in Task 14,
// not covered by unit tests.
export async function loginToChatGptWeb(
  store: import('./session-store').ChatGptWebSessionStore
): Promise<{ authenticated: boolean; verifiedAt: string }> {
  const { existsSync } = await import('node:fs')
  const { chromium } = await import('playwright-core')

  const cfg = store.loadConfig()
  const executablePath = resolveChromeExecutablePath({
    override: cfg.chromeExecutablePath,
    platform: process.platform,
    exists: existsSync
  })
  if (!executablePath) {
    throw new Error('No Chrome installation found. Set a custom Chrome path in Settings.')
  }

  const context = await chromium.launchPersistentContext('', {
    executablePath,
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto('https://chatgpt.com/?temporary-chat=true')
    // Wait for the user to finish signing in manually — presence of the
    // composer is our signal that we're authenticated.
    await page.waitForSelector('#prompt-textarea', { timeout: 5 * 60 * 1000 })

    const state = await context.storageState()
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const path = await import('node:path')
    mkdirSync(path.dirname(store.storageStatePath()), { recursive: true })
    writeFileSync(store.storageStatePath(), JSON.stringify(state, null, 2))

    const marker = { authenticated: true, verifiedAt: new Date().toISOString() }
    store.writeVerifiedMarker(marker)
    return marker
  } finally {
    await context.close()
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-browser-login.test.ts`
Expected: PASS (5 tests). `loginToChatGptWeb` is intentionally uncovered here.

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/browser-login.ts tests/unit/chatgpt-web-browser-login.test.ts
git commit -m "feat: add chatgpt-web manual login flow"
```

---

### Task 9: LLM client

**Files:**
- Create: `src/main/chatgpt-web/client.ts`
- Test: `tests/unit/chatgpt-web-client.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `LlmStreamOptions`, `LlmStreamPart` from `src/main/agent/llm.ts`; `compileChatGptWebPrompt` from Task 4; `parseChatGptWebResponse` from Task 5; `resolveChatGptWebEffort` from Task 2; `runChatGptWebTurn`, `CHATGPT_WEB_TAB_LIMITER` from Task 7; `ChatGptWebSessionStore` from Task 3.
- Produces: `export function createChatGptWebLlmClient(store: ChatGptWebSessionStore): LlmClient`. Used by Task 12 (`meow-agent-manager.ts`).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-client.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/chatgpt-web/browser-worker', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/chatgpt-web/browser-worker')>(
    '../../src/main/chatgpt-web/browser-worker'
  )
  return {
    ...actual,
    createChatGptWebPage: vi.fn(async () => ({}) as never),
    runChatGptWebTurn: vi.fn(async () => 'Sure.\n```tool_call\n{"name": "bash", "input": {"command": "ls"}}\n```')
  }
})

import { createChatGptWebLlmClient } from '../../src/main/chatgpt-web/client'
import { ChatGptWebSessionStore } from '../../src/main/chatgpt-web/session-store'

describe('createChatGptWebLlmClient', () => {
  it('streams text then tool-call then finish parts from the completed turn', async () => {
    const store = new ChatGptWebSessionStore('/tmp/does-not-matter')
    const client = createChatGptWebLlmClient(store)
    const parts = []
    for await (const part of client.stream({ model: 'high', system: 'sys', messages: [], tools: [] })) {
      parts.push(part)
    }
    expect(parts[0]).toEqual({ kind: 'text', text: 'Sure.' })
    expect(parts[1].kind).toBe('tool-call')
    expect(parts[1].toolName).toBe('bash')
    expect(parts[parts.length - 1].kind).toBe('finish')
  })

  it('yields an error part when the model id is not a known effort level', async () => {
    const store = new ChatGptWebSessionStore('/tmp/does-not-matter')
    const client = createChatGptWebLlmClient(store)
    const parts = []
    for await (const part of client.stream({ model: 'not-a-model', system: 'sys', messages: [], tools: [] })) {
      parts.push(part)
    }
    expect(parts).toEqual([{ kind: 'error', error: expect.stringContaining('not-a-model') }])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-client.test.ts`
Expected: FAIL — module not found (`client.ts` and `createChatGptWebPage` don't exist yet).

- [x] **Step 3: Add `createChatGptWebPage` to `browser-worker.ts`**

Append to `src/main/chatgpt-web/browser-worker.ts` (this is the real Playwright context/page setup that `client.ts` needs; it composes pieces already built in Task 7 and 8):

```typescript
// Appended to src/main/chatgpt-web/browser-worker.ts
export async function createChatGptWebPage(storageStatePath: string, chromeExecutablePath?: string): Promise<ChatGptWebPage> {
  const { existsSync } = await import('node:fs')
  const { chromium } = await import('playwright-core')
  const { resolveChromeExecutablePath } = await import('./browser-login')

  const executablePath = resolveChromeExecutablePath({
    override: chromeExecutablePath,
    platform: process.platform,
    exists: existsSync
  })
  if (!executablePath) {
    throw new Error('No Chrome installation found. Set a custom Chrome path in Settings.')
  }
  if (!existsSync(storageStatePath)) {
    throw new Error('Not logged into ChatGPT Web. Log in from Settings first.')
  }

  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()
  return wrapPlaywrightPage(page)
}
```

- [x] **Step 4: Implement `client.ts`**

```typescript
// src/main/chatgpt-web/client.ts
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../agent/llm'
import { compileChatGptWebPrompt } from './prompt'
import { parseChatGptWebResponse } from './response-parser'
import { resolveChatGptWebEffort } from './model-catalog'
import type { ChatGptWebSessionStore } from './session-store'

export function createChatGptWebLlmClient(store: ChatGptWebSessionStore): LlmClient {
  return {
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      const effort = resolveChatGptWebEffort(opts.model)
      if (!effort) {
        yield { kind: 'error', error: `Unknown chatgpt-web model "${opts.model}"` }
        return
      }

      const { createChatGptWebPage, runChatGptWebTurn, CHATGPT_WEB_TAB_LIMITER } = await import('./browser-worker')
      const cfg = store.loadConfig()
      const release = await CHATGPT_WEB_TAB_LIMITER.acquire()
      try {
        const prompt = compileChatGptWebPrompt(opts)
        const page = await createChatGptWebPage(store.storageStatePath(), cfg.chromeExecutablePath)
        const markdown = await runChatGptWebTurn(page, prompt, effort, opts.signal)
        for (const part of parseChatGptWebResponse(markdown)) yield part
        yield { kind: 'finish', finishReason: 'stop' }
      } catch (err) {
        yield { kind: 'error', error: err instanceof Error ? err.message : String(err) }
      } finally {
        release()
      }
    }
  }
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-client.test.ts`
Expected: PASS (2 tests).

- [x] **Step 6: Commit**

```bash
git add src/main/chatgpt-web/browser-worker.ts src/main/chatgpt-web/client.ts tests/unit/chatgpt-web-client.test.ts
git commit -m "feat: add chatgpt-web LlmClient implementation"
```

---

### Task 10: Manager facade

**Files:**
- Create: `src/main/chatgpt-web/manager.ts`
- Test: `tests/unit/chatgpt-web-manager.test.ts`

**Interfaces:**
- Consumes: `ChatGptWebSessionStore` from Task 3, `getChatGptWebModelRefs` from Task 2.
- Produces: `export class ChatGptWebManager { constructor(configDir: string); getStatus(): ChatGptWebStatus; setEnabled(enabled: boolean): ChatGptWebStatus; login(): Promise<ChatGptWebStatus>; logout(): ChatGptWebStatus; getModelRefsIfActive(): ModelRef[] }`. Used by Task 11 (IPC wiring) and Task 12 (`meow-agent-manager.ts`).
- `ChatGptWebStatus` is defined in Task 11 (`src/shared/types.ts`); this task defines it locally first and Task 11 re-exports the shared one — to avoid a forward dependency, define `ChatGptWebStatus` in `manager.ts` in this task, then Task 11 moves it to `src/shared/types.ts` and updates the import (called out explicitly in Task 11 Step 1).

- [x] **Step 1: Write the failing test**

```typescript
// tests/unit/chatgpt-web-manager.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatGptWebManager } from '../../src/main/chatgpt-web/manager'

describe('ChatGptWebManager', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'chatgpt-web-mgr-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('starts disabled and logged out', () => {
    const manager = new ChatGptWebManager(dir)
    expect(manager.getStatus()).toEqual({ enabled: false, loggedIn: false, verifiedAt: null })
  })

  it('setEnabled persists and reflects in getStatus', () => {
    const manager = new ChatGptWebManager(dir)
    const status = manager.setEnabled(true)
    expect(status.enabled).toBe(true)
    expect(new ChatGptWebManager(dir).getStatus().enabled).toBe(true)
  })

  it('getModelRefsIfActive is empty unless both enabled and logged in', () => {
    const manager = new ChatGptWebManager(dir)
    expect(manager.getModelRefsIfActive()).toEqual([])
    manager.setEnabled(true)
    expect(manager.getModelRefsIfActive()).toEqual([])
  })

  it('login delegates to the injected login function and updates status', async () => {
    const manager = new ChatGptWebManager(dir, {
      login: vi.fn(async () => ({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' }))
    })
    manager.setEnabled(true)
    const status = await manager.login()
    expect(status).toEqual({ enabled: true, loggedIn: true, verifiedAt: '2026-08-07T00:00:00.000Z' })
    expect(manager.getModelRefsIfActive()).toHaveLength(5)
  })

  it('logout clears the session and disables the provider from the picker again', async () => {
    const manager = new ChatGptWebManager(dir, {
      login: vi.fn(async () => ({ authenticated: true, verifiedAt: '2026-08-07T00:00:00.000Z' }))
    })
    manager.setEnabled(true)
    await manager.login()
    const status = manager.logout()
    expect(status.loggedIn).toBe(false)
    expect(manager.getModelRefsIfActive()).toEqual([])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chatgpt-web-manager.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```typescript
// src/main/chatgpt-web/manager.ts
import { ChatGptWebSessionStore } from './session-store'
import { getChatGptWebModelRefs } from './model-catalog'
import type { ModelRef } from '../../shared/types'

export interface ChatGptWebStatus {
  enabled: boolean
  loggedIn: boolean
  verifiedAt: string | null
}

export interface ChatGptWebManagerDeps {
  login?: (store: ChatGptWebSessionStore) => Promise<{ authenticated: boolean; verifiedAt: string }>
}

export class ChatGptWebManager {
  private readonly store: ChatGptWebSessionStore

  constructor(configDir: string, private readonly deps: ChatGptWebManagerDeps = {}) {
    this.store = new ChatGptWebSessionStore(configDir)
  }

  getStatus(): ChatGptWebStatus {
    const cfg = this.store.loadConfig()
    const marker = this.store.readVerifiedMarker()
    return { enabled: cfg.enabled, loggedIn: Boolean(marker?.authenticated), verifiedAt: marker?.verifiedAt ?? null }
  }

  setEnabled(enabled: boolean): ChatGptWebStatus {
    const cfg = this.store.loadConfig()
    this.store.saveConfig({ ...cfg, enabled })
    return this.getStatus()
  }

  async login(): Promise<ChatGptWebStatus> {
    const loginFn = this.deps.login ?? (await import('./browser-login')).loginToChatGptWeb
    await loginFn(this.store)
    return this.getStatus()
  }

  logout(): ChatGptWebStatus {
    this.store.clearSession()
    return this.getStatus()
  }

  getModelRefsIfActive(): ModelRef[] {
    const status = this.getStatus()
    return status.enabled && status.loggedIn ? getChatGptWebModelRefs() : []
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chatgpt-web-manager.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src/main/chatgpt-web/manager.ts tests/unit/chatgpt-web-manager.test.ts
git commit -m "feat: add chatgpt-web manager facade (status/enable/login/logout)"
```

---

### Task 11: Shared types, IPC channels, preload, main wiring

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/chatgpt-web/manager.ts` (move `ChatGptWebStatus` out to shared types)
- Modify: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `ChatGptWebManager` from Task 10.
- Produces: `window.api.getChatGptWebStatus/setChatGptWebEnabled/loginChatGptWeb/logoutChatGptWeb`, `mainApp.chatGptWeb: ChatGptWebManager`. Used by Task 12 and Task 13.

- [x] **Step 1: Move `ChatGptWebStatus` into shared types**

In `src/shared/types.ts`, add near `ModelRef`/`CatalogProviderSummary` (around line 239):

```typescript
export interface ChatGptWebStatus {
  enabled: boolean
  loggedIn: boolean
  verifiedAt: string | null
}
```

In `src/main/chatgpt-web/manager.ts`, replace the local `export interface ChatGptWebStatus {...}` definition with:

```typescript
import type { ChatGptWebStatus, ModelRef } from '../../shared/types'
```

(remove the now-duplicate `ModelRef` import line if one already exists from Task 10's implementation — keep a single import statement).

- [x] **Step 2: Add IPC channels**

In `src/shared/ipc.ts`, add to the `Channels` object (after `McpStatus`, line 63):

```typescript
  ChatGptWebGetStatus: 'chatgpt-web:get-status',
  ChatGptWebSetEnabled: 'chatgpt-web:set-enabled',
  ChatGptWebLogin: 'chatgpt-web:login',
  ChatGptWebLogout: 'chatgpt-web:logout',
```

Add to the `AgentApi` interface (after `getMcpStatus(): Promise<McpServerStatus[]>`, line 143):

```typescript
  getChatGptWebStatus(): Promise<ChatGptWebStatus>
  setChatGptWebEnabled(enabled: boolean): Promise<ChatGptWebStatus>
  loginChatGptWeb(): Promise<ChatGptWebStatus>
  logoutChatGptWeb(): Promise<ChatGptWebStatus>
```

Add `ChatGptWebStatus` to the type import at the top of `src/shared/ipc.ts` (line 1-5), alphabetically alongside the other imported types from `./types`.

- [x] **Step 3: Wire preload**

In `src/preload/index.ts`, add `ChatGptWebStatus` to the type import (line 3), and add to the `api` object (after `getMcpStatus`, line 90):

```typescript
  getChatGptWebStatus: () => ipcRenderer.invoke(Channels.ChatGptWebGetStatus),
  setChatGptWebEnabled: (enabled: boolean) => ipcRenderer.invoke(Channels.ChatGptWebSetEnabled, enabled),
  loginChatGptWeb: () => ipcRenderer.invoke(Channels.ChatGptWebLogin),
  logoutChatGptWeb: () => ipcRenderer.invoke(Channels.ChatGptWebLogout),
```

- [x] **Step 4: Wire main process**

In `src/main/index.ts`, add the import (alongside the other manager imports near the top):

```typescript
import { ChatGptWebManager } from './chatgpt-web/manager'
```

Add a property to `MainApp` (alongside `templates`, before `meowAgent`, around line 47):

```typescript
  chatGptWeb = new ChatGptWebManager(path.join(app.getPath('userData'), 'chatgpt-web'))
```

Register the four IPC handlers (near the other `Channels.Provider*`/`Channels.McpStatus` handlers, around line 398-403):

```typescript
  ipcMain.handle(Channels.ChatGptWebGetStatus, () => mainApp.chatGptWeb.getStatus())
  ipcMain.handle(Channels.ChatGptWebSetEnabled, (_e, enabled: boolean) => mainApp.chatGptWeb.setEnabled(enabled))
  ipcMain.handle(Channels.ChatGptWebLogin, () => mainApp.chatGptWeb.login())
  ipcMain.handle(Channels.ChatGptWebLogout, () => mainApp.chatGptWeb.logout())
```

- [x] **Step 5: Update the IPC contract test**

In `tests/unit/ipc-contract.test.ts`:
- Add `'getChatGptWebStatus', 'setChatGptWebEnabled', 'loginChatGptWeb', 'logoutChatGptWeb'` to the `required` array (Step 1's list, near `getMcpStatus`).
- Add the four methods to the `api: AgentApi = {...}` fixture object (near `getMcpStatus: async () => []`):

```typescript
      getChatGptWebStatus: async () => ({ enabled: false, loggedIn: false, verifiedAt: null }),
      setChatGptWebEnabled: async () => ({ enabled: false, loggedIn: false, verifiedAt: null }),
      loginChatGptWeb: async () => ({ enabled: false, loggedIn: false, verifiedAt: null }),
      logoutChatGptWeb: async () => ({ enabled: false, loggedIn: false, verifiedAt: null }),
```

- Add to the channel-name assertions (Step 2's second `it` block):

```typescript
    expect(Channels.ChatGptWebGetStatus).toBe('chatgpt-web:get-status')
    expect(Channels.ChatGptWebSetEnabled).toBe('chatgpt-web:set-enabled')
    expect(Channels.ChatGptWebLogin).toBe('chatgpt-web:login')
    expect(Channels.ChatGptWebLogout).toBe('chatgpt-web:logout')
```

- [x] **Step 6: Run the contract test and typecheck**

Run: `npx vitest run tests/unit/ipc-contract.test.ts tests/unit/chatgpt-web-manager.test.ts`
Expected: PASS (all tests, including the moved `ChatGptWebStatus` type still resolving correctly in Task 10's tests).

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts src/main/chatgpt-web/manager.ts tests/unit/ipc-contract.test.ts
git commit -m "feat: wire chatgpt-web status/login/logout IPC channels"
```

---

### Task 12: Integrate into `meow-agent-manager.ts`

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Modify: `tests/unit/meow-agent-manager.test.ts`

**Interfaces:**
- Consumes: `ChatGptWebManager` from Task 10, `createChatGptWebLlmClient` from Task 9, `CHATGPT_WEB_PROVIDER_ID` from Task 2.
- Produces: agents with `model: 'chatgpt-web/<effort>'` resolve to a `ChatGptWebLlmClient`; `getProviderModels()` includes chatgpt-web models when active.

- [x] **Step 1: Read the existing test file's dependency-injection pattern**

Open `tests/unit/meow-agent-manager.test.ts` and find how `deps.createLlm` is stubbed for existing tests (it's passed into the `MeowAgentManagerDeps` object at manager construction). Follow the exact same pattern for the new `deps.chatGptWeb` / `deps.createChatGptWebLlmClient`.

- [x] **Step 2: Write the failing tests**

Add to `tests/unit/meow-agent-manager.test.ts` (adjust the exact setup helper name/import list to match what the file already uses for constructing a `MeowAgentManager` in other tests in this file):

```typescript
import { CHATGPT_WEB_PROVIDER_ID } from '../../src/main/chatgpt-web/model-catalog'
import { ChatGptWebManager } from '../../src/main/chatgpt-web/manager'

// ... inside the existing describe block, alongside other provider-resolution tests:

it('constructs a ChatGptWebLlmClient instead of createLlm when provider is chatgpt-web', async () => {
  const fakeClient = { stream: async function* () { yield { kind: 'finish' as const, finishReason: 'stop' } } }
  const createChatGptWebLlmClient = vi.fn(() => fakeClient)
  const manager = makeManager({
    createChatGptWebLlmClient,
    createLlm: vi.fn(() => { throw new Error('should not be called for chatgpt-web') })
  })
  await manager.addAgentForTest({ model: `${CHATGPT_WEB_PROVIDER_ID}/high` })
  expect(createChatGptWebLlmClient).toHaveBeenCalledTimes(1)
})

it('includes chatgpt-web models in getProviderModels when the provider is enabled and logged in', () => {
  const chatGptWeb = new ChatGptWebManager('/tmp/chatgpt-web-test-does-not-need-to-exist-for-this-fake')
  vi.spyOn(chatGptWeb, 'getModelRefsIfActive').mockReturnValue([{ provider: CHATGPT_WEB_PROVIDER_ID, model: 'high' }])
  const manager = makeManager({ chatGptWeb })
  const refs = manager.getProviderModels()
  expect(refs).toContainEqual({ provider: CHATGPT_WEB_PROVIDER_ID, model: 'high' })
})
```

Adjust `makeManager({...})` / `addAgentForTest({...})` to whatever the file's actual existing test-setup helper functions are called — read the file first (Step 1) and match its conventions exactly rather than inventing new helper names.

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: FAIL — `deps.chatGptWeb`/`deps.createChatGptWebLlmClient` not recognized, or `createLlm` still called.

- [x] **Step 4: Implement**

In `src/main/meow-agent-manager.ts`:

Add imports near the top (alongside the existing `createLlm` import, line 10-11):

```typescript
import { createChatGptWebLlmClient } from './chatgpt-web/client'
import { CHATGPT_WEB_PROVIDER_ID } from './chatgpt-web/model-catalog'
import type { ChatGptWebManager } from './chatgpt-web/manager'
```

Add two optional fields to the deps interface (near `createLlm?`, line 41):

```typescript
  chatGptWeb?: ChatGptWebManager
  createChatGptWebLlmClient?: (store: ChatGptWebManager) => LlmClient
```

Update `getProviderModels()` (line 473-479) to append chatgpt-web models:

```typescript
  getProviderModels(): ModelRef[] {
    const cfg = loadMeowConfig(this.deps.configPath)
    const refs: ModelRef[] = []
    for (const [provider, p] of Object.entries(cfg.provider)) {
      for (const model of p.models) refs.push({ provider, model })
    }
    refs.push(...(this.deps.chatGptWeb?.getModelRefsIfActive() ?? []))
    return refs
  }
```

Update the client construction in `register()` (line 673):

```typescript
    const llmClient = resolved.provider === CHATGPT_WEB_PROVIDER_ID
      ? (this.deps.createChatGptWebLlmClient ?? createChatGptWebLlmClient)(this.deps.chatGptWeb as never)
      : (this.deps.createLlm ?? createLlm)(resolved.provider, resolved.apiKey ?? '', resolved.baseUrl)
```

Note: `createChatGptWebLlmClient` from Task 9 takes a `ChatGptWebSessionStore`, not a `ChatGptWebManager`. Rather than exposing the store publicly, add one small accessor to `ChatGptWebManager` (Task 10's class) to keep the store private everywhere else:

In `src/main/chatgpt-web/manager.ts`, add a method to `ChatGptWebManager`:

```typescript
  getSessionStore(): ChatGptWebSessionStore {
    return this.store
  }
```

Then in `meow-agent-manager.ts`, call it as `(this.deps.createChatGptWebLlmClient ?? ((m: ChatGptWebManager) => createChatGptWebLlmClient(m.getSessionStore())))(this.deps.chatGptWeb as ChatGptWebManager)`. Simplify by defining a small local wrapper at the top of the file instead of inlining that expression:

```typescript
function defaultCreateChatGptWebLlmClient(manager: ChatGptWebManager) {
  return createChatGptWebLlmClient(manager.getSessionStore())
}
```

and use `(this.deps.createChatGptWebLlmClient ?? defaultCreateChatGptWebLlmClient)(this.deps.chatGptWeb as ChatGptWebManager)` in `register()`.

Finally, in `src/main/index.ts` (Task 11 already added `chatGptWeb = new ChatGptWebManager(...)` to `MainApp`), pass it into the `MeowAgentManager` constructor call (around line 61, alongside `configPath`/`store`/`tools`):

```typescript
    chatGptWeb: this.chatGptWeb,
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: PASS, including the two new tests and every pre-existing test in the file (anthropic/google/openai-compatible paths unaffected).

Run the full unit suite to confirm no regressions elsewhere:
Run: `npx vitest run`
Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts src/main/chatgpt-web/manager.ts src/main/index.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat: resolve chatgpt-web provider to ChatGptWebLlmClient in agent manager"
```

---

### Task 13: Settings UI

**Files:**
- Create: `src/renderer/src/components/settings/ChatGptWebTab.tsx`
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api.getChatGptWebStatus/setChatGptWebEnabled/loginChatGptWeb/logoutChatGptWeb` from Task 11.
- Produces: a new "ChatGPT Web (Experimental)" tab, fully separate from `ProvidersTab.tsx`, with its own state (not part of the settings draft/save flow — changes apply immediately, matching how session state, not preferences, should behave).

- [x] **Step 1: Create the tab component**

```typescript
// src/renderer/src/components/settings/ChatGptWebTab.tsx
import { useCallback, useEffect, useState } from 'react'
import type { ChatGptWebStatus } from '@shared/types'

export default function ChatGptWebTab() {
  const [status, setStatus] = useState<ChatGptWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void window.api.getChatGptWebStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async () => {
    if (!status) return
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.setChatGptWebEnabled(!status.enabled))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.loginChatGptWeb())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.api.logoutChatGptWeb())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="settings-tab chatgpt-web-tab">Loading…</div>

  return (
    <div className="settings-tab chatgpt-web-tab">
      <div className="chatgpt-web-banner">
        <strong>Experimental.</strong> This drives a real, logged-in ChatGPT web session through
        browser automation — it is not an official API. It can break when ChatGPT changes its UI,
        and usage is subject to your own ChatGPT account's Terms of Use. Official providers
        (Anthropic/Google/OpenAI-compatible) remain the primary, supported path.
      </div>

      <div className="chatgpt-web-row">
        <span>Enable chatgpt-web provider</span>
        <button className="btn" disabled={busy} onClick={() => void toggle()}>
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="chatgpt-web-row">
        <span>
          Session:{' '}
          {status.loggedIn
            ? `logged in (verified ${new Date(status.verifiedAt ?? '').toLocaleString()})`
            : 'not logged in'}
        </span>
        {status.loggedIn ? (
          <button className="btn" disabled={busy} onClick={() => void logout()}>Logout</button>
        ) : (
          <button className="btn primary" disabled={busy || !status.enabled} onClick={() => void login()}>
            {busy ? 'Waiting for login…' : 'Login with ChatGPT'}
          </button>
        )}
      </div>

      {!status.enabled && <p className="settings-hint">Enable the provider first to log in.</p>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
```

- [x] **Step 2: Wire the tab into `SettingsDialog.tsx`**

In `src/renderer/src/components/settings/SettingsDialog.tsx`:

Add the import (line 8, after `CommandsTab`):

```typescript
import ChatGptWebTab from './ChatGptWebTab'
```

Add `'chatgpt-web'` to the `TabId` union (line 10):

```typescript
type TabId = 'providers' | 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'chatgpt-web'
```

Add an entry to `TABS` (line 12-19), as the last entry to visually separate it from the official providers:

```typescript
  { id: 'chatgpt-web', label: 'ChatGPT Web (Experimental)' }
```

Add the render branch (after the `commands` branch, line 127):

```typescript
            {tab === 'chatgpt-web' && <ChatGptWebTab />}
```

- [x] **Step 3: Add minimal styles**

In `src/renderer/src/styles.css`, add (near the other `.settings-*`/`.provider-*` rules — find that section and append):

```css
.chatgpt-web-banner {
  background: var(--color-warning-bg, #3a2f13);
  border: 1px solid var(--color-warning-border, #7a5c1e);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 0.9em;
  line-height: 1.4;
}

.chatgpt-web-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border, #2a2a2a);
}
```

If `--color-warning-bg`/`--color-warning-border`/`--color-border` custom properties don't already exist in this codebase's theme, check `src/renderer/src/styles.css` for the actual variable names in use nearby and substitute those instead of introducing new ones.

- [x] **Step 4: Manual verification**

Run: `npm run dev`
Expected: app launches; open Settings → "ChatGPT Web (Experimental)" tab appears last in the nav; toggling Enable persists across a dialog close/reopen; clicking "Login with ChatGPT" is disabled until enabled. (Do not actually complete a real login yet — that requires Task 14's Chrome setup.)

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/ChatGptWebTab.tsx src/renderer/src/components/settings/SettingsDialog.tsx src/renderer/src/styles.css
git commit -m "feat: add ChatGPT Web settings tab"
```

---

### Task 14: Manual smoke test + docs

**Files:**
- Create: `docs/testing/chatgpt-web-smoke-test.md`

**Interfaces:**
- Consumes: the whole feature, end to end.
- Produces: a repeatable manual verification checklist (this mechanism cannot be fully automated — same limitation the reference project documents).

- [x] **Step 1: Write the smoke-test doc**

```markdown
<!-- docs/testing/chatgpt-web-smoke-test.md -->
# ChatGPT Web Provider — Manual Smoke Test

Automated tests cover every pure function (prompt compiling, response parsing,
model catalog, session store, manager facade). They cannot cover real browser
automation. Run this checklist by hand after any change to
`src/main/chatgpt-web/browser-worker.ts` or `browser-login.ts`, and before
each release that touches this feature.

## Prerequisites
- Google Chrome installed locally (or set a custom path via Settings → ChatGPT
  Web → will be exposed once the config UI for `chromeExecutablePath` is
  added — until then, edit `<userData>/chatgpt-web/config.json` directly).
- A ChatGPT account you're willing to use for browser automation.

## 1. Selector check (do this first, and after any ChatGPT UI change)
1. Open `https://chatgpt.com/?temporary-chat=true` in Chrome, signed in.
2. Open DevTools → Elements and confirm each selector in
   `src/main/chatgpt-web/browser-worker.ts`'s `SELECTORS` still matches:
   composer, send button, effort menu trigger + menu items, stop button,
   copy button, answer root, rate-limit dialog container.
3. Update `SELECTORS` if anything drifted; re-run `npx vitest run tests/unit/chatgpt-web-browser-worker.test.ts`
   (still passes — it doesn't depend on the real selectors) then proceed to step 2.

## 2. Login flow
1. `npm run dev`, open Settings → "ChatGPT Web (Experimental)", click Enable.
2. Click "Login with ChatGPT". A visible Chrome window should open to
   chatgpt.com. Sign in manually.
3. Within 5 minutes of the composer becoming visible, the app should report
   "logged in" with a verified timestamp. If it times out, check the console
   for the exact error.

## 3. First turn (text only)
1. In the chat panel, pick an agent using the native `meow` template, open the
   model picker, and select `chatgpt-web / medium`.
2. Send a simple prompt ("what's 2+2?"). A headless Chrome should launch
   briefly; the answer should appear in the chat panel once ChatGPT finishes
   responding (there is no live token streaming for this provider — see the
   plan's Task 7 note).

## 4. Tool-call turn
1. Ask the agent to do something that requires a tool, e.g. "list the files in
   this project's root directory."
2. Confirm the agent actually runs `bash`/`glob` (visible as a tool-call card
   in the chat UI) rather than the raw `tool_call` JSON block leaking into the
   visible answer text.

## 5. Failure paths
1. Log out, then try sending a message on the chatgpt-web provider again —
   should fail with a clear "not logged into ChatGPT Web" error, not a crash.
2. (Optional, hard to trigger deliberately) If you hit ChatGPT's own
   rate-limit dialog, confirm the agent surfaces a clear rate-limit error
   instead of hanging or silently retrying.

## 6. Isolation check
1. Switch the same agent back to an anthropic/google/openai-compatible model
   and confirm it still works exactly as before — this feature must never
   affect the official providers.
2. With the chatgpt-web provider disabled (Settings toggle off), confirm no
   Chrome process is spawned by the app at all (check your OS process list).
```

- [x] **Step 2: Run the full automated suite one more time**

Run: `npx vitest run`
Expected: all tests pass, including every `chatgpt-web-*` test file from Tasks 2-12.

Run: `npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit`
Expected: no type errors in either the main or renderer project.

- [x] **Step 3: Commit**

```bash
git add docs/testing/chatgpt-web-smoke-test.md
git commit -m "docs: add chatgpt-web manual smoke-test checklist"
```

- [x] **Step 4: Walk through the manual smoke test yourself**

Follow `docs/testing/chatgpt-web-smoke-test.md` end to end at least once before considering this feature done. Fix any selector drift or bug found, adding a regression test to the relevant pure-logic module where possible (e.g., if a new dialog phrasing needs matching, add a case to `isChatGptWebRateLimitDialog`'s test in Task 6).


> **Update 2026-08-07 (persistent profile + Cloudflare fallback):**
> The original smoke-test steps above still apply for selector drift detection.
> After applying the persistent-profile fix, also walk through the following
> 6-step procedure (from spec docs/superpowers/specs/2026-08-07-chatgpt-web-persistent-profile-design.md §10.2):
>
> 1. **Fresh install + login.** Open Settings → "Login ChatGPT Web". A visible Chrome opens; sign in manually; close it. Verify both userData/chatgpt-web/storage-state.json and userData/chatgpt-web/browser-profile/Cookies exist.
> 2. **Headless chat turn.** Send a message through the chatgpt-web provider. Chat flow opens a headless Chrome; response returns normally.
> 3. **Profile survives missing JSON.** Delete storage-state.json, keep browser-profile/. Send another message — it still works (browser-profile is the source of truth; ephemeral context loads from it).
> 4. **Fallback to visible on Cloudflare.** Corrupt browser-profile/Cookies (e.g., empty it). Send a message — a visible Chrome window pops up + the renderer toast "[meow] Cloudflare cần xác minh. Vui lòng giải trong cửa sổ Chrome vừa mở." Solve the challenge; chat resumes.
> 5. **Logout wipes everything.** Logout from Settings. Verify both storage-state.json and browser-profile/ are deleted.
> 6. **Re-login creates fresh profile.** Login again from Settings. Verify a new browser-profile/ is created and the chat flow works.
