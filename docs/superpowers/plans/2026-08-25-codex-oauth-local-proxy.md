# Codex OAuth Local Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-account Codex OAuth to Meow Coding, let users choose the active Codex account and model, and run native-agent chat through an account-scoped local OpenAI-compatible proxy.

**Architecture:** Keep API-key providers unchanged. Add a main-process connection subsystem that stores non-secret account metadata in an atomic JSON index and OAuth tokens only in Electron safeStorage. A Codex OAuth adapter obtains and refreshes tokens through PKCE loopback OAuth. A bundled, app-owned CLIProxyAPI wrapper runs on loopback and accepts account-scoped local credentials, so each native chat request can be routed only through the selected Codex account.

**Tech Stack:** Electron main process, TypeScript strict mode, React 19, Vitest, Playwright, Electron safeStorage, Node child processes, Go sidecar built around CLIProxyAPI v7.1.22.

**Spec:** docs/superpowers/specs/2026-08-25-codex-oauth-local-proxy-design.md

## Global Constraints

- Preserve existing base URL and API-key provider flows without migration or behavior changes.
- Support Codex OAuth in this release; keep provider interfaces open for Claude Code and Antigravity adapters without shipping their OAuth flows.
- Store only account metadata in userData/connections/index.json. Store OAuth access tokens, refresh tokens, and ID tokens only in Vault through Electron safeStorage.
- Never read, import, or overwrite external Codex CLI credentials such as .codex/auth.json.
- Bind proxy and OAuth callback listeners to 127.0.0.1 only. Generate random callback state, PKCE verifier, local proxy credentials, and runtime directory names.
- Make the proxy account-scoped: a local credential issued for account A must not be usable to route a request through account B.
- Remove plaintext proxy runtime material on graceful shutdown and clean stale runtime directories at next launch. Do not log credentials, authorization headers, tokens, or callback query values.
- All new IPC channels must be declared in src/shared/ipc.ts and exposed only through the typed preload bridge.
- Update all affected unit and integration tests. Before completion, run npm run typecheck, npm test, and npm run build plus npm run e2e when the updated e2e flow is available.
- Keep _dump_paths.py untracked and out of every commit.

## Planned File Structure

- src/shared/types.ts: connection account and account-aware model types.
- src/shared/ipc.ts: typed connection IPC contract and account-aware agent-model signature.
- src/preload/index.ts: narrow typed preload bridge for connection operations.
- src/main/connections/types.ts: internal OAuth token and connection state types.
- src/main/connections/connection-store.ts: atomic metadata index persistence.
- src/main/connections/codex-oauth.ts: PKCE browser authorization, loopback callback, token exchange and refresh.
- src/main/connections/codex-proxy-manager.ts: sidecar lifecycle, account-scoped proxy access and runtime cleanup.
- src/main/connections/connections-manager.ts: orchestration API used by IPC and native chat.
- src/main/connections/index.ts: public main-process connection module exports.
- sidecars/meow-cliproxy/: small app-owned Go wrapper around CLIProxyAPI v7.1.22.
- scripts/build-cliproxy.mjs: reproducible sidecar build for development and packaging.
- resources/third-party/CLIProxyAPI-LICENSE: bundled MIT license notice.
- src/main/agent/config.ts and src/main/meow-agent-manager.ts: selected connection resolution for native chat.
- src/main/index.ts: dependency construction, lifecycle, and IPC handlers.
- src/renderer/src/components/settings/ProvidersTab.tsx: Codex account controls.
- src/renderer/src/components/chat/ModelPicker.tsx: selected-account model choices.
- src/renderer/src/components/ProvidersScreen.tsx and styles: account status and actionable errors.
- tests/unit/: shared contract, store, OAuth, proxy, connections manager, agent config and manager coverage.
- tests/e2e/: stable visible smoke coverage for Providers and active-account model selection.

## Task 1: Define Account-Aware Shared Contracts

**Files:**

- Modify: src/shared/types.ts
- Modify: src/shared/ipc.ts
- Modify: src/preload/index.ts
- Modify: tests/unit/ipc-contract.test.ts
- Create: tests/unit/connection-shared-types.test.ts

- [ ] Step 1: Write failing shared-contract tests for a Codex connection account, an account-aware ModelRef, and the typed AgentApi operations: list accounts, begin Codex OAuth, disconnect account, select active account, and select an agent model with accountId.

~~~ts
expect(Channels.ConnectionList).toBeDefined()
expect(windowApi.setAgentModel).toHaveBeenCalledWith(
  agentId,
  { provider: 'codex', accountId: 'codex-account-1', model: 'gpt-5.3-codex' }
)
~~~

- [ ] Step 2: Run npm test -- tests/unit/ipc-contract.test.ts tests/unit/connection-shared-types.test.ts and confirm the tests fail because the contract has no connection APIs or account identifier.

- [ ] Step 3: Add shared types with explicit lifecycle information.

~~~ts
export interface ConnectionAccount {
  id: string
  provider: 'codex'
  email?: string
  displayName: string
  active: boolean
  createdAt: string
  lastUsedAt?: string
  status: 'ready' | 'refreshing' | 'expired' | 'error'
  error?: string
}

export interface ModelRef {
  provider: string
  model: string
  accountId?: string
  accountLabel?: string
}
~~~

- [ ] Step 4: Add Channels entries and AgentApi methods using connection objects, never raw OAuth material. Change setAgentModel to take a single ModelRef and update preload to invoke only those declared channels.

- [ ] Step 5: Re-run npm test -- tests/unit/ipc-contract.test.ts tests/unit/connection-shared-types.test.ts and confirm it passes.

- [ ] Step 6: Commit only the contract changes.

~~~bash
git add src/shared/types.ts src/shared/ipc.ts src/preload/index.ts tests/unit/ipc-contract.test.ts tests/unit/connection-shared-types.test.ts
git commit -m "feat: add account-aware provider contracts"
~~~

## Task 2: Persist Connection Metadata and Secrets Safely

**Files:**

- Modify: src/main/vault.ts
- Create: src/main/connections/types.ts
- Create: src/main/connections/connection-store.ts
- Create: tests/unit/connection-store.test.ts
- Modify: tests/unit/vault.test.ts

- [ ] Step 1: Write failing tests that add, update, select, remove, and reload Codex account metadata, assert exactly one active account per provider, and prove index.json never contains an OAuth token. Add Vault tests for a connection secret reference.

~~~ts
expect(await store.list('codex')).toEqual([
  expect.objectContaining({ id: 'acct-a', active: true, status: 'ready' })
])
expect(await fs.readFile(indexPath, 'utf8')).not.toContain('refresh-token')
expect(vault.getSecret('connection:codex:acct-a')).toEqual({
  accessToken: 'access-token',
  refreshToken: 'refresh-token'
})
~~~

- [ ] Step 2: Run npm test -- tests/unit/connection-store.test.ts tests/unit/vault.test.ts and confirm the new persistence tests fail.

- [ ] Step 3: Implement ConnectionStore under userData/connections. Persist a versioned metadata document by writing a sibling temporary file and atomically renaming it. Validate loaded data, discard malformed entries, and ensure selecting an account clears active on its Codex peers.

- [ ] Step 4: Add internal CodexOAuthTokens and secret-key helpers. Reuse Vault for all token values, return no secret from public store APIs, and add a Vault presence helper if the manager needs to distinguish missing from malformed secret data.

- [ ] Step 5: Re-run npm test -- tests/unit/connection-store.test.ts tests/unit/vault.test.ts and confirm it passes.

- [ ] Step 6: Commit the persistence layer.

~~~bash
git add src/main/vault.ts src/main/connections/types.ts src/main/connections/connection-store.ts tests/unit/connection-store.test.ts tests/unit/vault.test.ts
git commit -m "feat: store OAuth connection metadata securely"
~~~

## Task 3: Implement the Codex PKCE OAuth Adapter

**Files:**

- Create: src/main/connections/codex-oauth.ts
- Create: tests/unit/codex-oauth.test.ts
- Modify: src/main/connections/types.ts

- [ ] Step 1: Write failing tests with injected browser, HTTP listener, clock, random bytes, and token transport. Cover generated PKCE verifier and challenge, a state mismatch rejection, callback timeout cleanup, successful exchange, profile extraction, refresh before expiry, and expired-refresh failure.

~~~ts
const result = await oauth.authorize()
expect(result).toMatchObject({
  email: 'dev@example.com',
  tokens: expect.objectContaining({ refreshToken: 'refresh-token' })
})
expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('code_challenge='))
~~~

- [ ] Step 2: Run npm test -- tests/unit/codex-oauth.test.ts and confirm it fails because the adapter does not exist.

- [ ] Step 3: Implement CodexOAuth with documented Codex OAuth client identity and authorization endpoints. Generate a cryptographically random state and verifier, derive a SHA-256 base64url challenge, listen only on 127.0.0.1 with an ephemeral port, launch the system browser, and close the listener on every success, failure, timeout, and dispose path.

- [ ] Step 4: Exchange the callback code only after exact state validation. Store token expiry as an ISO timestamp, decode or query only the minimum profile claims required for display name and email, and expose refreshTokens(tokens) without writing to disk or logging response content.

- [ ] Step 5: Re-run npm test -- tests/unit/codex-oauth.test.ts and confirm it passes.

- [ ] Step 6: Commit the adapter and its tests.

~~~bash
git add src/main/connections/codex-oauth.ts src/main/connections/types.ts tests/unit/codex-oauth.test.ts
git commit -m "feat: add Codex OAuth PKCE adapter"
~~~

## Task 4: Build and Run an Account-Scoped Local Proxy Sidecar

**Files:**

- Create: sidecars/meow-cliproxy/go.mod
- Create: sidecars/meow-cliproxy/main.go
- Create: sidecars/meow-cliproxy/README.md
- Create: scripts/build-cliproxy.mjs
- Create: resources/third-party/CLIProxyAPI-LICENSE
- Create: src/main/connections/codex-proxy-manager.ts
- Create: tests/unit/codex-proxy-manager.test.ts
- Modify: package.json
- Modify: electron-builder.ts

- [ ] Step 1: Write failing CodexProxyManager tests using an injected child-process factory and free-port allocator. Cover loopback arguments, unique runtime directory, redacted diagnostics, issuing distinct local credentials for two accounts, refusing cross-account access, child exit recovery, graceful stop, and stale-runtime cleanup.

~~~ts
const a = await manager.getEndpoint('acct-a')
const b = await manager.getEndpoint('acct-b')
expect(a.apiKey).not.toBe(b.apiKey)
expect(spawn).toHaveBeenCalledWith(
  expect.stringContaining('meow-cliproxy'),
  expect.arrayContaining(['--host', '127.0.0.1']),
  expect.anything()
)
~~~

- [ ] Step 2: Run npm test -- tests/unit/codex-proxy-manager.test.ts and confirm it fails.

- [ ] Step 3: Implement the Go wrapper as Meow-owned glue around the pinned github.com/router-for-me/CLIProxyAPI/v7 module at v7.1.22. Its startup configuration must accept only loopback host, a generated port, a runtime configuration path, and a mapping of local credential to exactly one Codex account. It must reject credentials missing from the mapping and must not apply automatic account rotation or fallback.

- [ ] Step 4: Implement CodexProxyManager. At startup remove stale userData/connections/runtime directories, create a random current run directory with restricted file permissions, write the minimal sidecar configuration there, start the bundled executable without shell interpolation, wait for a loopback health check, and return OpenAI-compatible base URL plus the selected account local credential.

- [ ] Step 5: On account token refresh, regenerate only that account mapping and request a safe sidecar reload or controlled restart. On shutdown, terminate the child process, remove the current runtime directory, and ensure all emitted errors mask paths, credentials, authorization headers, and token values.

- [ ] Step 6: Add an npm script to build the sidecar for development and configure electron-builder extra resources for platform executables plus the upstream MIT license notice.

- [ ] Step 7: Re-run npm test -- tests/unit/codex-proxy-manager.test.ts and npm run build:cliproxy. Confirm both pass on the development platform.

- [ ] Step 8: Commit proxy source, packaging metadata, and tests.

~~~bash
git add sidecars/meow-cliproxy scripts/build-cliproxy.mjs resources/third-party/CLIProxyAPI-LICENSE src/main/connections/codex-proxy-manager.ts tests/unit/codex-proxy-manager.test.ts package.json electron-builder.ts
git commit -m "feat: add account-scoped Codex proxy sidecar"
~~~

## Task 5: Orchestrate Connections and Resolve Native Chat Requests

**Files:**

- Create: src/main/connections/connections-manager.ts
- Create: src/main/connections/index.ts
- Create: tests/unit/connections-manager.test.ts
- Modify: src/main/agent/config.ts
- Modify: src/main/meow-agent-manager.ts
- Modify: tests/unit/agent-config.test.ts
- Modify: tests/unit/meow-agent-manager.test.ts

- [ ] Step 1: Write failing ConnectionsManager tests that connect a Codex account, save secrets through Vault, activate another account, refresh an expiring token, return active-account models, disconnect and clean up an account, and return a user-safe error when no active ready account exists.

- [ ] Step 2: Write failing agent config and MeowAgentManager tests that choose provider codex with accountId, obtain the selected account endpoint from ConnectionsManager, create an OpenAI-compatible LLM client with its local base URL and local credential, and never require an API key for that route.

~~~ts
expect(createLlm).toHaveBeenCalledWith(
  'codex',
  'local-account-scoped-key',
  'http://127.0.0.1:43123/v1'
)
~~~

- [ ] Step 3: Run npm test -- tests/unit/connections-manager.test.ts tests/unit/agent-config.test.ts tests/unit/meow-agent-manager.test.ts and confirm the added tests fail.

- [ ] Step 4: Implement ConnectionsManager as the sole owner of store, Vault, OAuth adapter, and proxy manager. Its public methods are listAccounts, connectCodex, disconnect, setActive, getActiveCodexModels, getChatEndpoint, and dispose. Refresh tokens before use with a conservative expiry window; change status to refreshing, expired, or error without exposing secret information.

- [ ] Step 5: Extend agent configuration parsing to preserve accountId alongside provider and model. Update MeowAgentManager dependencies and model persistence so a native agent with ModelRef provider codex and accountId resolves through ConnectionsManager, while every existing API-key provider continues through the current resolver unchanged.

- [ ] Step 6: Re-run npm test -- tests/unit/connections-manager.test.ts tests/unit/agent-config.test.ts tests/unit/meow-agent-manager.test.ts and confirm it passes.

- [ ] Step 7: Commit the orchestration and chat integration.

~~~bash
git add src/main/connections/connections-manager.ts src/main/connections/index.ts src/main/agent/config.ts src/main/meow-agent-manager.ts tests/unit/connections-manager.test.ts tests/unit/agent-config.test.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat: route native chat through selected Codex account"
~~~

## Task 6: Wire Main-Process Lifecycle and IPC

**Files:**

- Modify: src/main/index.ts
- Modify: tests/unit/ipc-contract.test.ts
- Create or modify: tests/unit/main-connections-integration.test.ts

- [ ] Step 1: Write failing main integration tests that assert typed connection IPC handlers delegate to MainApp, model selection stores the full ModelRef including accountId, and app shutdown disposes the connections manager before the process exits.

- [ ] Step 2: Run npm test -- tests/unit/main-connections-integration.test.ts tests/unit/ipc-contract.test.ts and confirm it fails.

- [ ] Step 3: Construct ConnectionsManager with the existing userData and Vault paths in MainApp. Register handlers only using Channels.ConnectionList, Channels.ConnectionConnectCodex, Channels.ConnectionDisconnect, Channels.ConnectionSetActive, and Channels.ConnectionGetModels. Validate all renderer inputs in main before forwarding them.

- [ ] Step 4: Update agent model IPC and workspace persistence to use ModelRef. Preserve backwards-compatible loading of existing provider slash model strings; save the new account-aware form in a stable serialized representation that can be decoded on restart.

- [ ] Step 5: Insert connectionsManager.dispose into the existing ordered before-quit lifecycle before app.exit. Make it idempotent to tolerate repeated Electron lifecycle signals.

- [ ] Step 6: Re-run npm test -- tests/unit/main-connections-integration.test.ts tests/unit/ipc-contract.test.ts and confirm it passes.

- [ ] Step 7: Commit the main-process wiring.

~~~bash
git add src/main/index.ts tests/unit/ipc-contract.test.ts tests/unit/main-connections-integration.test.ts
git commit -m "feat: expose Codex connection lifecycle over IPC"
~~~

## Task 7: Deliver the Providers and Model-Picker User Flow

**Files:**

- Modify: src/renderer/src/components/settings/ProvidersTab.tsx
- Modify: src/renderer/src/components/ProvidersScreen.tsx
- Modify: src/renderer/src/components/chat/ModelPicker.tsx
- Modify: src/renderer/src/components/App.tsx
- Modify: src/renderer/src/styles.css or the relevant component styles
- Modify: tests/e2e/smoke.spec.ts
- Modify: tests/unit/officecli-binary-manager.test.ts

- [ ] Step 1: Write failing renderer and Playwright coverage for a Codex provider card with Connect Codex, an account list, active-account selector, disconnect action, ready versus expired states, and a ModelPicker that shows only the active account's models and records accountId on selection.

~~~ts
await page.getByRole('button', { name: 'Connect Codex' }).click()
await expect(page.getByText('Connected account')).toBeVisible()
await page.getByRole('button', { name: /gpt-5.*codex/i }).click()
~~~

- [ ] Step 2: Run npm test -- tests/unit and npm run build then npm run e2e -- tests/e2e/smoke.spec.ts. Confirm the new assertions fail before the UI implementation.

- [ ] Step 3: Add a dedicated Codex section to ProvidersTab without removing existing API-key cards. Use the connection APIs to connect, display only non-secret identity metadata, change the active account, disconnect, and render clear retry or reconnect actions for error and expired status. Disable model selection when no account is ready.

- [ ] Step 4: Update ModelPicker to group Codex choices under the active account display name and call setAgentModel with provider, accountId, and model. Keep existing provider-only selections functional. Surface a concise non-secret error state if models cannot load.

- [ ] Step 5: Stabilize e2e data by mocking the connection IPC boundary rather than launching real OAuth or a real proxy. Restrict any OfficeCliBinary test default environments to an explicit empty PATH except tests intentionally validating PATH discovery, so local machine shims cannot alter unrelated suite results.

- [ ] Step 6: Re-run npm test -- tests/unit, npm run build, and npm run e2e -- tests/e2e/smoke.spec.ts. Confirm the user flow passes.

- [ ] Step 7: Commit the UI, e2e coverage, and test-environment isolation.

~~~bash
git add src/renderer/src/components/settings/ProvidersTab.tsx src/renderer/src/components/ProvidersScreen.tsx src/renderer/src/components/chat/ModelPicker.tsx src/renderer/src/components/App.tsx src/renderer/src/styles.css tests/e2e/smoke.spec.ts tests/unit/officecli-binary-manager.test.ts
git commit -m "feat: manage Codex OAuth accounts in providers"
~~~

## Task 8: Full Verification, Documentation, and Review

**Files:**

- Modify: README.md or the existing user-facing setup documentation
- Modify: docs/changelog-format.md only if its rules require an entry format update
- Create: docs/release-notes/codex-oauth.md if release notes are managed there

- [ ] Step 1: Add user-facing documentation for connecting multiple Codex accounts, selecting the active one, using its models in native chat, where account metadata is stored, and how disconnect works. Include the CLIProxyAPI MIT attribution and explain that Claude Code and Antigravity OAuth are not enabled in this release.

- [ ] Step 2: Run npm run typecheck and record the clean output.

- [ ] Step 3: Run npm test and confirm all tests pass. If any OfficeCliBinary tests fail because a host-installed officecli is found, verify the explicit test environments from Task 7 are present instead of changing production discovery logic.

- [ ] Step 4: Run npm run build and npm run e2e. Verify packaged resource configuration includes the sidecar and its license notice.

- [ ] Step 5: Run git diff --check, git status --short, and inspect staged or final diff. Confirm _dump_paths.py remains untracked and no token, endpoint authorization header, callback URL, or generated runtime file appears in the repository.

- [ ] Step 6: Request a code review using superpowers:requesting-code-review. Resolve any confirmed findings and repeat the relevant verification.

- [ ] Step 7: Commit documentation and any review fixes.

~~~bash
git add README.md docs/release-notes/codex-oauth.md
git commit -m "docs: explain Codex OAuth connections"
~~~

## Completion Criteria

- A user can connect two or more Codex OAuth accounts and sees only masked, non-secret account metadata.
- Exactly one ready Codex account can be active; switching it changes the Codex models available in the chat model picker.
- Selecting a Codex model persists its provider, accountId, and model and native-agent chat uses the selected account through a loopback OpenAI-compatible sidecar.
- Existing base URL and API-key providers still work.
- OAuth tokens are protected by Electron safeStorage and never appear in index files, logs, renderer data, tests snapshots, or commits.
- Proxy credentials are account-scoped, loopback-only, ephemeral, and cleaned up.
- npm run typecheck, npm test, npm run build, and npm run e2e all pass.
