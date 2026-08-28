# Meow Agent Full Harness System Prompt — Design Spec

Date: 2026-08-29 · Status: awaiting review

## 1. Goal

Rebuild the native "Meow" agent's system prompt as a structured **harness prompt** mirroring
Claude Code's design: a clearly sectioned builder, an environment context block, a per-project
file-based **memory system**, and dynamic `<system-reminder>` injection at turn boundaries and in
tool results.

The native agent already has a mature harness (loop, compaction, permissions, skills, subagents,
sessions). Compared with Claude Code, the prompt itself is missing:

- **Structured assembly** — the prompt is currently a flat concatenation of four parts
  (`systemPrompt` + `modeNote` + `AGENTS.md` text + skills list).
- **Environment context** — the model does not know what platform, shell, cwd, or git state it
  runs in.
- **Persistent cross-session memory** — sessions persist, but there is no durable memory of user
  preferences, project decisions, or behavioral feedback.
- **Dynamic context** — `<system-reminder>` is only used when attaching instructions on file read
  (`loop.ts:355`), never at turn boundaries.

Out of scope: the tool loop, permissions, compaction, and subagent mechanics themselves (they are
already implemented and are referenced only where the prompt must interact with them).

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope | System prompt assembly + memory + reminder injection only |
| Structure | `buildSystemPrompt()` producing clearly labeled sections |
| Static vs dynamic | Static sections → system prompt (provider-cached); dynamic context → `<system-reminder>` in messages, recomputed each turn. Mode note stays static (it is rebuilt on `setMode`); dynamic reminders carry env snapshot + memory index |
| Environment | New `env.ts` snapshot: platform, shell, cwd, date, git `{branch, dirtyCount}` (null when not a repo) |
| Memory scope | Per-project: `<cwd>/.meow/memory/` |
| Memory format | `MEMORY.md` index + per-fact files with frontmatter (`name`, `description`, `metadata.type: user|feedback|project|reference`), `[[name]]` links |
| Memory writing | System-prompt rules; the agent uses existing `write`/`edit` tools; **no new tool** |
| Memory recall | Index loaded at turn start (≤ 200 lines); the agent `read`s specific files when relevant |
| Memory in git | `.meow/memory/` gitignored (agent state, not project content) |
| Reminder injection | Turn start (env + memory index) **and** tool results (bash/git freshness; write/edit inside the memory dir). Mode stays in the static prompt (rebuilt on `setMode`), so it is not duplicated in the reminder |
| Precedence | `AGENTS.md`/`CLAUDE.md` > memory > skills > base `systemPrompt` |
| Config | A single optional toggle to disable memory; kept minimal |
| Docs language | English, per `AGENTS.md` (docs must be written in English) |

## 3. Architecture

### Core principle: static vs dynamic split

Claude Code keeps two layers so the provider can cache the stable prefix:

- **Static** (into the system prompt, cached): identity/how-to-work, project instructions, skills,
  memory rules, precedence.
- **Dynamic** (as `<system-reminder>` blocks in messages, **not** cached): environment snapshot,
  memory index, mode/permissions. Recomputed every turn so it is always fresh.

The current `system:` closure in `meow-agent-manager.ts` concatenates static *and* dynamic content
into the system prompt — if environment were added there it would go stale inside the provider
cache. This design separates the two layers, which also fits the existing Anthropic cache
breakpoints in `llm.ts`.

### 3.1 `src/main/agent/prompt.ts` (new) — structured builder

```
buildSystemPrompt({
  baseSystemPrompt,   // user's meow.json systemPrompt — preserved, backward compatible
  modeNote,           // plan/build addendum (existing logic kept)
  instructionFiles,   // AGENTS.md/CLAUDE.md (existing loadInstructions kept)
  skills,             // collectSkills → description list (kept)
  memoryRules,        // rules + memory dir path (new)
  precedenceNote      // "AGENTS.md/CLAUDE.md > memory > skills > base" (new)
}) => string
```

Sections produced, in order:

1. `# Identity & how to work` — the user's `baseSystemPrompt` (the default "You are Meow…"
   paragraph, or whatever the user configured).
2. `# Project instructions` — `instructionsText(loadInstructions(cwd))`.
3. `# Memory` — memory directory path, `MEMORY.md` rules, and when/how to write a fact.
4. `# Skills` — `skillListText(collectSkills(...))`.
5. `# Mode & permissions` — the mode note (plan/build), kept as today.
6. Precedence note: project instructions > memory > skills > base.

The output is a single string. The function is pure and unit-testable.

### 3.2 `src/main/agent/env.ts` (new) — environment snapshot

```
snapshotEnvironment(cwd): Promise<EnvSnapshot>
EnvSnapshot = { platform, shell, cwd, date, git: { branch, dirtyCount } | null }
```

- Reuses `GitStatusService` for git; when not a repo (or the call fails/times out) → `git: null`,
  never blocks the turn.
- Called once per turn (one git command; cheap).
- `shell`: `process.env.SHELL` / `COMSPEC`, with a platform-derived default.

### 3.3 `src/main/agent/memory.ts` (new) — per-project memory

Location: `<cwd>/.meow/memory/`.

- **`MEMORY.md`** — index, one line per memory (`- [Title](file.md) — hook`). Loaded at turn start,
  truncated to ≤ 200 lines. This is the recall mechanism: the agent sees the index, then `read`s a
  specific file when it is relevant.
- **Per-fact files** `<slug>.md` with frontmatter:
  ```markdown
  ---
  name: <short-kebab-case-slug>
  description: <one-line summary>
  metadata:
    type: user | feedback | project | reference
  ---
  <the fact>
  ```
  For `feedback`/`project` facts the body follows `**Why:**` / `**How to apply:**` lines, matching
  Claude Code's memory format. Related memories link with `[[name]]`.
- **Rules text** embedded in the system prompt tells the agent:
  - When it learns a durable fact (user preference, project decision, behavioral feedback) it should
    write one file per fact with `write`/`edit` and update the index.
  - Do **not** store what the repo already records (code, git history, `AGENTS.md`).
  - Check for an existing file covering the fact before creating a duplicate.
  - Ask the user before storing anything sensitive.
- **Robustness**: a file with broken frontmatter is skipped from the index (memory is data, not
  instructions); a missing/unreadable `MEMORY.md` yields an empty index.

### 3.4 `src/main/agent/loop.ts` (modified) — reminder injection

- **Turn start**: `toLlmMessages(items, opts)` gains a per-run `turnContext`. It prepends a `user`
  message whose first content block is a `<system-reminder>` carrying the environment snapshot +
  memory index. (Mode stays in the static prompt via `modeNote`; it is rebuilt on `setMode`, so a
  dynamic copy would be redundant.) This happens at the transform layer — the reminder is **not**
  written to the session store, so it never pollutes undo/redo or the chat feed. Computed once per
  `run()` (steering messages do not re-inject it).
- **Tool results**:
  - `read` → attach nearby `AGENTS.md`/`CLAUDE.md` (existing behavior kept).
  - `bash`/`git` → inject an env/git freshness reminder.
  - `write`/`edit` targeting a path under the memory dir → reminder to keep `MEMORY.md` in sync.

### 3.5 `src/main/meow-agent-manager.ts` (modified) — wiring

- Registration: replace the `system:` closure (`:1151`) with one that calls `buildSystemPrompt(...)`.
  Keep it a **per-run function** (as today) so an edited `AGENTS.md` or a newly added skill takes
  effect on the next turn without a reload; the provider still caches the stable prefix.
- Per turn: `snapshotEnvironment(cwd)` + `loadMemoryIndex(cwd)` → passed into `toLlmMessages` via
  `turnContext`.

## 4. Data flow

```
Registration
  buildSystemPrompt(static)           → system prompt (provider-cached)

Turn start
  snapshotEnvironment(cwd)            → env {platform, shell, git, date}
  loadMemoryIndex(<cwd>/.meow/memory) → MEMORY.md (≤ 200 lines)
  toLlmMessages(items, {turnContext}) → prepend <system-reminder> user message
      (env + memory index + mode)     — NOT written to the store

During the turn
  read   → attach nearby AGENTS.md/CLAUDE.md (existing)
  bash/git → inject env/git freshness reminder
  write/edit into .meow/memory/       → reminder to update MEMORY.md

Agent writes memory
  write/edit (existing tools)         → fact file + index update, per prompt rules

Next turn
  memory index recalled again         → agent read()s a specific fact when relevant
```

## 5. Error handling

| Situation | Behavior |
|---|---|
| Not a git repository | `env.git = null`; platform/shell/cwd still included |
| `git status` slow/fails | short timeout, git omitted, turn proceeds |
| Memory dir creation fails | log a warning, turn runs without memory |
| `MEMORY.md` too large | truncate to ≤ 200 lines, note it in the reminder |
| Fact file has broken frontmatter | skipped from the index (data, not instructions) |
| `write` tool cannot reach `.meow/memory/` | verify during implementation; if permission/scope blocks it, handle explicitly (see §8) |

## 6. Testing

- **Unit**: `prompt.ts` (all sections present, precedence order), `memory.ts` (index parse,
  frontmatter parse, corrupt-file skip, truncate), `env.ts` (git present/absent).
- **Integration**: turn-start reminder appears in `toLlmMessages` exactly once per run (not on
  steering); bash/git tool results carry a freshness reminder.
- **E2E**: the agent observes environment (e.g. an agent transcript contains the platform); the
  agent writes a memory file via `write`; a new session recalls the index.

## 7. Files

**New:** `src/main/agent/prompt.ts` · `src/main/agent/env.ts` · `src/main/agent/memory.ts` ·
tests (`tests/unit/prompt.test.ts`, `tests/unit/memory.test.ts`, `tests/unit/env.test.ts`,
`tests/integration/reminder-injection.test.ts`).

**Modified:** `src/main/meow-agent-manager.ts` (builder wiring, per-turn context) ·
`src/main/agent/loop.ts` (turn-start + tool-result reminders) · `src/main/agent/config.ts` (optional
memory toggle, kept minimal) · module `AGENTS.md` + `docs/reference/03-agent-runtime.md`
(docs-sync rule).

## 8. Open questions

- Whether the `write` tool can currently reach `<cwd>/.meow/memory/` under the default permission
  rules (it is inside the project cwd, so likely yes, but verify during implementation). If not, the
  memory rules must instruct the agent to request permission, or a narrow exception must be added.

## 9. Success criteria

1. The system prompt is assembled by a structured builder with clearly labeled sections and a
   stated precedence (project instructions > memory > skills > base).
2. At turn start the model sees a fresh `<system-reminder>` with platform, shell, cwd, date, and git
   branch/dirty count (when available), plus the memory index.
3. The agent can write a durable fact to `<cwd>/.meow/memory/` using the existing `write`/`edit`
   tools and it is recalled on a later session.
4. Memory files are never injected into the session store/chat feed; undo/redo and the transcript
   are unaffected.
5. Unit + integration tests pass; `npm run typecheck` passes; docs (`AGENTS.md`, reference
   `03-agent-runtime.md`) updated in the same commits.
