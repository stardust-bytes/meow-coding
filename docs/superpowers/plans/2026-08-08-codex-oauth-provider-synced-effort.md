# Codex OAuth Provider-Synced Effort — Implementation Plan

> **For implementers:** Required execution skill: use `superpowers:executing-plans` to perform this plan task-by-task.

**Goal:** Let a Codex OAuth model expose only the reasoning-effort variants declared by the bundled CLIProxyAPI Codex client model registry, and forward a selected valid effort through the account-scoped proxy.

**Architecture:** Extend the Meow-owned Go sidecar to write a non-secret, per-launch catalog file from CLIProxyAPI's Codex registry (`slug`, `display_name`, and `supported_reasoning_levels[].effort`). `CodexProxyManager` reads that private runtime file after the sidecar is healthy and supplies the normalized catalog to the TypeScript connection manager. The connection manager publishes effort lists on `ModelRef` and resolves a selected Codex variant to an OpenAI-compatible descriptor only after revalidating it against the same catalog. Existing renderer model/variant controls remain generic; their existing model-change refresh and invalid-selection reset behavior consumes the new metadata.

**Tech Stack:** Go 1.26, CLIProxyAPI v7.2.141 SDK, Electron 41, React 19, TypeScript strict, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-08-codex-oauth-provider-synced-effort-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `sidecars/meow-cliproxy/main.go` | Write a non-secret catalog file from CLIProxyAPI's Codex registry into the private runtime directory. |
| `sidecars/meow-cliproxy/main_test.go` | Go tests for catalog projection and runtime-file writing behavior. |
| `src/shared/types.ts` | Add non-secret per-model variant metadata to `ModelRef`. |
| `src/main/connections/types.ts` | Define private TypeScript sidecar catalog response types and the narrow normalized Codex model shape. |
| `src/main/connections/codex-model-catalog.ts` (new) | Pure JSON adapter: validate/projection of sidecar catalog data; reject malformed entries and derive OpenAI-compatible variant descriptors. |
| `src/main/connections/codex-proxy-manager.ts` | Read the private runtime catalog file after sidecar startup and expose an account-independent catalog snapshot. |
| `src/main/connections/connections-manager.ts` | Store the sidecar registry snapshot, return its variants on `ModelRef`, invalidate it on sidecar/account lifecycle events, and resolve a valid Codex variant for the agent manager. |
| `src/main/meow-agent-manager.ts` | Ask the connection manager for Codex variant descriptors rather than looking up `models.dev` catalog variants; revalidate on both picker query and runner registration. |
| `src/main/index.ts` | No intended production change: the existing `ConnectionGetModels` handler and connection dependency wiring should suffice. Verify this while implementing. |
| `src/preload/index.ts` | No intended production change: `getConnectionModels()` already carries typed `ModelRef`; verify the exposed method needs no new channel. |
| `src/renderer/src/components/chat/ModelPicker.tsx` | No intended structural change: it already requests connection models and dispatches the model-change event. Verify it preserves metadata as it selects `ModelRef`. |
| `src/renderer/src/components/chat/ChatPanel.tsx` | No intended structural change: it already fetches variants and clears stale selections. Add a focused renderer test only if a test harness exists; otherwise validate through manager/API tests and the e2e smoke suite. |
| `tests/unit/codex-model-catalog.test.ts` (new) | Unit coverage for response validation and descriptor construction. |
| `tests/unit/connections-manager.test.ts` | Connection manager tests for authenticated catalog fetch, no-effort models, malformed/error fallback, lifecycle cache invalidation. |
| `tests/unit/meow-agent-manager.test.ts` or existing manager test file | Add Codex-specific variant resolution coverage at the manager boundary; create the focused file if no manager unit test exists. |
| `tests/unit/llm-variant.test.ts` | Regression assertion that OpenAI-compatible `reasoningEffort` reaches the request body unchanged, including registry-only values such as `ultra`. |

## Task 1: Publish the provider registry from the sidecar runtime

**Files:**
- Modify: `sidecars/meow-cliproxy/main.go`
- Modify: `sidecars/meow-cliproxy/main_test.go`

### Step 1: Write failing Go tests for a safe catalog projection and runtime file

Add tests before production changes that exercise a pure helper accepting registry model data or a representative registry payload. Cover:

- Models project to `{ id, name, variants }`, where `id` is the CLIProxyAPI `slug`, name comes from `display_name` with an ID fallback, and variants preserve registry order from `supported_reasoning_levels[].effort`.
- Empty/malformed/non-string effort entries are discarded.
- A model with no valid supported reasoning levels remains in the result with an empty `variants` list (the TypeScript/UI layer will hide its picker).
- The helper writes `{ data: [...] }` to the run-directory catalog file with private permissions; the status payload references that path.
- The test fixture includes an uncommon current registry value such as `ultra`, proving no static Meow allow-list silently strips provider-supported values.

Run: `cd sidecars/meow-cliproxy && go test ./...`

Expected: compilation/test failure because the projection helper and runtime catalog writer do not exist yet.

### Step 2: Implement the projection and private runtime catalog file

In `sidecars/meow-cliproxy/main.go`:

1. Import the CLIProxyAPI registry package that exposes the live embedded/refreshed Codex client catalog (`GetCodexClientModelsSnapshot` / JSON) and decode its JSON payload.
2. Add small local structs for the catalog consumed by Meow. Do not include OAuth metadata, runtime configuration, raw registry blobs, or provider routing details.
3. Build a pure projection helper. It must defensively validate entries, trim IDs/efforts, deduplicate an effort while retaining first-seen order, and return an empty variants slice rather than inventing a default.
4. After creating `runDir` and before writing the ready status file, write the projected JSON as `models.json` in that run directory, mode `0600`. The JSON shape is `{ data: [{ id, name, variants }] }`.
5. Include the catalog file path in the existing private status JSON as a top-level `modelsPath` field. Do not expose it over HTTP or in Electron IPC; it is read only by `CodexProxyManager` while the runtime directory exists.
6. If the model registry updater changes content while the sidecar is running, the current process lifecycle does not need a push mechanism: a proxy refresh/restart creates a new catalog snapshot, and Meow reloads it. Do not add an unauthenticated endpoint or management route.

Do not use `/v1/models` as the capability source: that OpenAI-compatible endpoint only guarantees IDs and does not carry registry effort metadata.

### Step 3: Prove Go tests pass

Run: `cd sidecars/meow-cliproxy && gofmt -w main.go main_test.go && go test ./...`

Expected: all sidecar tests pass.

### Step 4: Commit

```bash
git add sidecars/meow-cliproxy/main.go sidecars/meow-cliproxy/main_test.go
git commit -m "feat(codex): expose provider model efforts from sidecar"
```

## Task 2: Add typed client metadata and a pure TS catalog adapter

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/connections/types.ts`
- Create: `src/main/connections/codex-model-catalog.ts`
- Create: `tests/unit/codex-model-catalog.test.ts`

### Step 1: Write failing adapter tests

Create `tests/unit/codex-model-catalog.test.ts` with fixtures for the JSON route response. Specify these exact behaviors:

- Valid entries yield normalized `{ model, label, variants }`; output variants preserve registry order and allow provider-defined names including `max` and `ultra`.
- Omit entries lacking a nonempty string `id`.
- Treat malformed/missing `variants` as `[]`; do not fallback to `CODEX_FALLBACK_MODELS`, `models.dev`, or generic OpenAI effort values.
- Trim duplicate/blank effort strings, retaining first valid occurrence.
- Conversion of a validated string `high` produces `{ openaiCompatible: { reasoningEffort: 'high' } }`.
- An absent/stale effort does not produce a descriptor.

Run: `npx vitest run tests/unit/codex-model-catalog.test.ts`

Expected: fail because the adapter/types do not exist.

### Step 2: Extend `ModelRef` without leaking private fields

In `src/shared/types.ts`, add optional `variants?: string[]` to `ModelRef` with documentation that it is non-secret provider-declared model variant IDs. Keep `provider`, `model`, and account fields unchanged so every existing caller remains source-compatible.

Do not put endpoint URLs, account credentials, raw registry content, or default reasoning configuration into shared types.

### Step 3: Implement the adapter

In `src/main/connections/types.ts`, add private wire types for `CodexModelCatalogResponse` and its item shape. In the new `codex-model-catalog.ts`:

- Export a pure `parseCodexModelCatalog(json: unknown)` function returning a normalized list suitable for `ModelRef` construction.
- Export a pure `codexVariantOptions(variants: readonly string[], selected: string | undefined)` function that returns `VariantDescriptor | undefined`.
- Keep the descriptor namespace exactly `openaiCompatible`; retain the selected provider value as-is (no `max` → `xhigh` translation), because the registry and CLIProxyAPI are the authority.
- Keep parsing independent from Electron, fetch, stores, and React for easy fixture testing.

### Step 4: Run focused tests and typecheck

Run:

```bash
npx vitest run tests/unit/codex-model-catalog.test.ts
npm run typecheck
```

Expected: pass.

### Step 5: Commit

```bash
git add src/shared/types.ts src/main/connections/types.ts src/main/connections/codex-model-catalog.ts tests/unit/codex-model-catalog.test.ts
git commit -m "feat(codex): model provider-synced effort metadata"
```

## Task 3: Read/cache the sidecar catalog and resolve it per account

**Files:**
- Modify: `src/main/connections/codex-proxy-manager.ts`
- Modify: `src/main/connections/connections-manager.ts`
- Modify: `tests/unit/codex-proxy-manager.test.ts`
- Modify: `tests/unit/connections-manager.test.ts`

### Step 1: Write failing proxy-manager and connection-manager tests

Add proxy-manager tests that use its existing runtime-dir/status-file fixtures:

1. The parsed sidecar status contains `modelsPath`, and `start()` reads that private JSON only after the sidecar becomes healthy.
2. A missing, malformed, or unreadable catalog file does not fail proxy startup; `getModelCatalog()` returns no catalog.
3. `stop()` clears the in-memory catalog before removing the runtime directory.

Add connection-manager tests using a proxy catalog stub:

1. `getActiveCodexModels()` returns `ModelRef`s with active account ID, account label, model ID, and parsed provider variants.
2. A valid model with `variants: []` remains selectable but has no variants.
3. Missing/invalid sidecar catalog retains the existing curated **model-ID** fallback behavior but attaches no variants. This explicitly satisfies “hide picker” and prevents generic effort fallback.
4. Catalog state is cleared whenever sidecar accounts are refreshed/restarted: connect while started, disconnect a nonfinal account, token-refresh proxy reload, and dispose/restart paths. The next `getActiveCodexModels()` must consume the new proxy snapshot rather than stale capability metadata.
5. A resolver method for a nonactive/unknown account or a model absent from its sidecar catalog returns `undefined`, not a generic descriptor.

Run: `npx vitest run tests/unit/codex-proxy-manager.test.ts tests/unit/connections-manager.test.ts`

Expected: these added cases fail first.

### Step 2: Implement sidecar-file reading and cache lifecycle

In `CodexProxyManager`:

1. Extend `SidecarConfig`/status parsing with optional `modelsPath` and inject a `readModelCatalogFile` dependency for deterministic tests.
2. After `waitForStatusFile()` and health checks complete, read and validate the catalog path only if it lies within the current run directory; reject paths outside it and never surface them to renderer callers.
3. Keep a private in-memory catalog snapshot and expose a narrow `getModelCatalog()` method. Clear it in `stop()` and whenever a new `start()` replaces an old sidecar.

In `ConnectionsManager`:

1. Replace the `/models` capability fetch with the proxy snapshot plus `parseCodexModelCatalog`.
2. Retain the current `CODEX_FALLBACK_MODELS` only as a model availability fallback. On fallback return rows with `variants: []`; never attach inferred efforts.
3. Update `getActiveCodexModels()` to map catalog rows to `ModelRef`, including `variants` and existing account label fields.
4. Add `getCodexVariantOptions(accountId, model, selectedVariant)` (or a similarly named narrow method) which gets the current proxy catalog and calls the pure adapter. It must return `undefined` on missing, stale, empty, or unsupported selections.
5. Invalidate any manager-derived catalog cache after every successful `proxy.start`, `proxy.refreshAccounts`, proxy stop, account disconnect, and account state mutation that can make the runtime snapshot stale. Keep a small private helper so lifecycle paths cannot drift.
6. Preserve account isolation: account authorization still comes from the requesting account's endpoint; because the provider registry is process-wide, the same non-secret model capability snapshot may be read for each ready account, but it must never make a non-ready account selectable.

Do not persist catalog data beyond the sidecar runtime directory or expose its path/content through IPC.

### Step 3: Run focused tests

Run:

```bash
npx vitest run tests/unit/codex-proxy-manager.test.ts tests/unit/connections-manager.test.ts tests/unit/codex-model-catalog.test.ts
npm run typecheck
```

Expected: pass.

### Step 4: Commit

```bash
git add src/main/connections/codex-proxy-manager.ts src/main/connections/connections-manager.ts tests/unit/codex-proxy-manager.test.ts tests/unit/connections-manager.test.ts
git commit -m "feat(codex): load effort catalog from provider registry"
```

## Task 4: Resolve Codex variants in the native agent path

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Create or modify: `tests/unit/meow-agent-manager.test.ts`
- Modify: `tests/unit/llm-variant.test.ts`

### Step 1: Add failing manager-boundary tests

Locate an existing MeowAgentManager fixture; if none can create a manager with a minimal fake `AccountEndpointResolver`, add `tests/unit/meow-agent-manager.test.ts`. Cover:

- A Codex OAuth agent asks the injected connection capability for `['low', 'high', 'ultra']` and `getAvailableVariants()` returns precisely that array.
- A Codex model without variants returns `[]`, allowing the existing `ChatPanel` conditional to hide its picker.
- Generic catalog lookup is not consulted for Codex OAuth models, proving no models.dev/static fallback leaks into the picker.
- Registering a Codex runner forwards `{ openaiCompatible: { reasoningEffort: 'ultra' } }` only if the connection resolver validates it.
- A stale selected effort results in no `variantOptions` passed to `SessionRunner`/LLM.
- Non-Codex providers keep their existing `modelVariants` descriptor lookup behavior.

In `tests/unit/llm-variant.test.ts`, add or extend the actual HTTP capture assertion for `ultra` so the AI SDK emits `reasoning_effort: 'ultra'` unchanged. This protects against accidental old `max` remapping.

Run:

```bash
npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/llm-variant.test.ts
```

Expected: newly added manager tests fail first.

### Step 2: Extend the injected connection interface deliberately

In `src/main/meow-agent-manager.ts`, widen the local `AccountEndpointResolver` dependency only with the narrow method needed to resolve Codex variant options. Its return type should be `Promise<VariantDescriptor | undefined>` (or the existing `VariantBody`-compatible type), avoiding imports of connection implementation details.

Update the construction wiring in `src/main/index.ts` only if TypeScript requires the new method to be supplied from `ConnectionsManager`; do not add IPC channels.

### Step 3: Implement picker and runner resolution

In `MeowAgentManager`:

1. Make `allowedVariantsFor()` branch only when the resolved provider is `codex` and the agent has an account ID. Ask `ConnectionsManager` for provider-synced capabilities; otherwise retain existing catalog descriptor keys. Since the manager method is currently synchronous, convert this private helper and `getAvailableVariants()` to async as needed, retaining the existing async public method/IPC contract.
2. During `register()`, resolve selected Codex variant asynchronously before `SessionRunner` is constructed, or introduce a lazy async resolver at send/run time if registration cannot await. Choose the smallest change that guarantees a stale saved workspace variant cannot enter `LlmClient.stream()`.
3. For non-Codex agents retain `this.modelVariants.get(...)?.[agent.variant]` exactly as today.
4. For Codex agents rely exclusively on `connections.getCodexVariantOptions(...)`; do not invoke `computeVariants`, `models.dev`, `CODEX_FALLBACK_MODELS`, or generic OpenAI effort lists.
5. If an invalid Codex variant is detected, clear the in-memory agent variant. Ensure the existing main app persistence path is notified/updated so a remount does not restore it; add a narrowly scoped callback/event only if current `setModel`/variant synchronization cannot persist this automatic reset.

### Step 4: Verify focused behavior

Run:

```bash
npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/llm-variant.test.ts tests/unit/connections-manager.test.ts
npm run typecheck
```

Expected: pass.

### Step 5: Commit

```bash
git add src/main/meow-agent-manager.ts src/main/index.ts tests/unit/meow-agent-manager.test.ts tests/unit/llm-variant.test.ts
git commit -m "feat(codex): apply provider-synced effort variants"
```

If no `index.ts` or manager test file changed, omit it from `git add`; never stage unrelated `_dump_paths.py`.

## Task 5: Validate existing renderer/IPC contracts and run full regression

**Files:**
- Inspect only unless required by a concrete discovered gap: `src/preload/index.ts`, `src/renderer/src/components/chat/ModelPicker.tsx`, `src/renderer/src/components/chat/ChatPanel.tsx`, `src/shared/ipc.ts`, `src/main/index.ts`
- Modify only if tests demonstrate that optional `ModelRef.variants` is lost across a boundary or stale selection is not reset/persisted.

### Step 1: Confirm no IPC or renderer plumbing change is necessary

Verify:

- `ConnectionGetModels` already returns `ModelRef[]` and preload directly forwards it.
- `ModelPicker` keeps the selected `ModelRef` object intact when invoking `setAgentModel`.
- It dispatches `meow:model-changed` after a model choice.
- `ChatPanel.refreshVariants()` refetches `getAgentVariants()`, conditionally renders only nonempty lists, and calls `onVariantChange(undefined)` when the old variant is absent.

If all conditions hold, leave these files unchanged. The feature is intentionally delivered through the existing typed model and variant IPC paths.

### Step 2: Add a targeted UI test only if supported

If the repository has a React component test setup, add coverage for a Codex model with variants and one with no variants. Otherwise do not introduce a new testing framework for this narrow change; the manager tests plus existing behavior cover it.

### Step 3: Run mandatory verification

Run in order:

```bash
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected: all commands pass. The build regenerates/copies sidecar artifacts according to existing scripts; if it does not rebuild the Go sidecar, follow the repository's documented sidecar build command and verify the packaged binary includes Task 1 before treating e2e as sufficient.

### Step 4: Inspect repository state

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors; only intentional feature commits are present, plus pre-existing untracked `_dump_paths.py` remains unstaged.

### Step 5: Optional documentation update and final commit

If the user-facing Codex OAuth document has an appropriate model-selection section, add a short note that effort choices come from the installed CLIProxyAPI registry and are hidden where unsupported. Do not claim every Codex model supports reasoning.

```bash
git add docs/release-notes/codex-oauth.md
git commit -m "docs: explain Codex OAuth effort availability"
```

Skip this commit if no documentation change is warranted.

---

## Implementation notes and guardrails

- The current `/v1/models` query in `ConnectionsManager` returns IDs only. It cannot fulfill provider-synced effort discovery. The Meow-owned private runtime catalog is necessary because CLIProxyAPI's current registry already knows `supported_reasoning_levels` but does not expose it through the OpenAI models endpoint.
- The sidecar must remain loopback-only. The catalog file belongs inside its mode-`0700` per-launch runtime directory and must be mode `0600`; neither its path nor raw contents may cross IPC, and a renderer must never receive a proxy credential.
- `CODEX_FALLBACK_MODELS` may continue to help a warming/unreachable sidecar populate models, but every fallback row must have `variants: []`; that is the explicitly approved behavior.
- Registry values are opaque provider capabilities. Preserve `ultra`, `max`, `xhigh`, and future values rather than applying the older generic `model-variants.ts` OpenAI-compatible rules.
- `models-catalog.ts` and `model-variants.ts` remain responsible for API-key provider catalog variants. Do not pollute them with Codex OAuth rules.
- Do not hardcode IPC channel strings; retain `Channels` and existing AgentApi method contracts.
