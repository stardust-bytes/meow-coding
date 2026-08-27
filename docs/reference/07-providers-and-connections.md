# 07 — Providers, Models & Connections

Two independent ways to reach a model:

| Path | Auth | Where configured | Code |
|---|---|---|---|
| **Provider** | API key (vault / plaintext / env) | Settings → Providers, stored in `meow.json` `provider` | `agent/config.ts`, `agent/llm.ts` |
| **Connection** | OAuth account (currently Codex / ChatGPT) | Settings → Providers → Model Connections, stored under `userData/connections` | `main/connections/`, `sidecars/meow-cliproxy/` |

## 7.1 Providers

### Configuration shape

```jsonc
"provider": {
  "<id>": {
    "keyRef":  "provider:<id>",   // preferred — reference into the encrypted vault
    "apiKey":  "",                // plaintext fallback when safeStorage is unavailable
    "apiKeyEnv": "<ID>_API_KEY",  // env fallback, auto-set when neither of the above is present
    "baseUrl": "https://…",
    "models":  ["model-a", "model-b"],
    "providerType": "deepseek"    // optional API-compatibility hint
  }
},
"model": "<default provider id>"
```

`resolveApiKey(provider, env, getSecret)` tries in order: `apiKey` → `getSecret(keyRef)` →
`env[apiKeyEnv]`.

### SDK selection (`createLlm`)

| `provider` id | Client |
|---|---|
| `anthropic` | `@ai-sdk/anthropic` |
| `google` | `@ai-sdk/google` |
| anything else | `@ai-sdk/openai-compatible` with `baseURL` (default `https://api.openai.com/v1`) |

**DeepSeek handling** is triggered when the provider id is `deepseek`, `providerType === 'deepseek'`,
or the base URL hostname ends with `deepseek.com`. It enables `includeUsage: true` (DeepSeek only
reports streamed usage when `stream_options.include_usage` is sent) and a custom `convertUsage` that
reads cache hits from `prompt_cache_hit_tokens` rather than OpenAI's
`prompt_tokens_details.cached_tokens`. `providerType` is also what drives echoing
`reasoning_content` back in subsequent requests for reasoning models that require it
(`agent/message.ts` emits a `reasoning` assistant part).

**Anthropic prompt caching** is explicit: `providerOptions.anthropic.cacheControl = ephemeral` caches
the system prompt, and `withCacheBreakpoints` tags the end of the stable prefix plus the last message
so the cache grows one turn at a time (0.1× input price instead of 1.0×). For a compacted transcript
the break goes *after* the summary, not on the one-line marker.

### Connecting a provider (`MeowAgentManager.connectProvider`)

Signature: `connectProvider(providerId, apiKey, baseUrl?, models?, providerType?)`.

1. Reject non-ASCII API keys with an actionable error (they would fail deep in undici with
   `Cannot convert argument to a ByteString`).
2. An **empty `apiKey` on an existing provider keeps the stored secret** — so an edit that only
   changes the base URL does not require re-entering the key.
3. When `safeStorage` is available, the key is written to the vault as `provider:<id>` and the
   plaintext field is cleared; otherwise it is stored in plaintext.
4. Base URL resolution: explicit argument → catalog `api` → previously stored value. `ollama-cloud`
   is normalized to `https://ollama.com/v1`.
5. Model list resolution, in strict priority:
   1. **Explicit `models[]`** typed into the UI — this is how a user adds an OpenAI-compatible
      endpoint that is not in models.dev
   2. Live `GET <baseUrl>/models`
   3. models.dev catalog
   4. previously stored list
6. `defaultProvider` is set to this provider if the previous default no longer exists.
7. `writeSettingsAndReload` writes synchronously and kicks off `reload()` **without awaiting** — MCP
   reconnection inside `reload()` can take up to 60s per server and would block the modal.

`disconnectProvider` deletes the vault secret, removes the provider entry, and reassigns the default.

## 7.2 Model catalog (`models-catalog.ts`)

- Source: **`https://models.dev/api.json`**, 10s timeout.
- The bundled `src/main/models-snapshot.json` is merged **under** the live response, so a provider
  missing from the live payload still resolves, and the app works fully offline.
- Cached in `userData/models.json` with a **5-minute TTL**; a cache written in an older shape (array
  variants) is ignored.
- Regenerate the snapshot with `npm run regen:models`.

API:

| Method | Returns |
|---|---|
| `fetch()` | `Record<providerId, CatalogProvider>` — `{ name, api, npm, models[], limits, variants }` |
| `list()` | `CatalogProviderSummary[]` for the Providers UI |
| `getModelLimit(providerId, modelId)` | `{ context?, output? }` |
| `getVariants` / `getVariantOptions` | Variant ids / the provider option body for one variant |
| `fetchLiveModelsInfo(baseUrl, apiKey)` | `GET <baseUrl>/models` with `Authorization: Bearer`, parsed for id + limits; `null` on any failure |
| `fetchLiveModels(baseUrl, apiKey)` | Same, ids only (used by "Sync models") |

`parseLiveModelsInfo` reads limits from whichever field the endpoint uses:

- context: `context_window`, `max_context_length`, `context_length`
- output: `max_output_tokens`, `max_tokens`, `output_tokens`

## 7.3 Limit resolution (`agent/limits.ts`)

`LimitsService.resolveLimits({ provider, model, baseUrl, apiKey, overrides })` → `{ context, output }`.

The design principle in the code is *"trust the provider, verify by error"* — every tier is a guess
until the provider itself confirms or refutes it.

| Priority | Source | Notes |
|---|---|---|
| 1 | **Overrides** | `maxContextTokens` / `maxOutputTokens` from `meow.json` |
| 2 | **Learned** | `learned-limits.json`, keyed `normalizeLearnedKey(baseUrl, model)`. Written only by provider rejections; only ever tightens |
| 3 | **Live `/models`** | Cached per `baseUrl\|apiKey` with `LIVE_MODELS_TTL_MS = 5min`. The lookup is **synchronous**: a cache miss kicks a background fetch (deduped) and returns what is currently known |
| 4 | **Catalog** | models.dev. Its `output` is capped at `MAX_OUTPUT_HARD_CAP` (131 072) because the catalog is the one source that can overclaim wildly |
| 5 | **Default** | `context: 128000`, `output: null` |

**`output: null` means omit `max_tokens` from the request entirely.** That is precisely what makes
`max_tokens exceeds model's maximum output tokens` impossible for models whose real cap is unknown.

Model-id matching (`matchModel`) is forgiving because server tags drift from config ids: exact match
→ match after stripping `:tag` (Ollama Cloud serves `deepseek-v4-flash:0731` for
`deepseek-v4-flash`) → substring containment either way (namespaced Fireworks ids).

### Learning from errors

| Error | Detector | Recorded as |
|---|---|---|
| Context overflow | `classifyContextOverflowError` matches `prompt is too long`, `context length exceeded`, `maximum context length`, `context_length_exceeded`, `exceeds the context window`, `please reduce the length of the messages` | `parseContextLimitFromError(message) ?? estimateUsage(prompt)` → `recordContextOverflow` |
| `max_tokens` rejected | `reduceBudgetForMaxTokensError` parses `max_tokens (N) exceeds model's maximum output tokens (M)` | `M` → `recordMaxTokensLimit`, and the same request is immediately retried with budget `M` |

`parseContextLimitFromError` handles the OpenAI phrasing
(`This model's maximum context length is 128000 tokens`), the Anthropic phrasing
(`prompt is too long: 19000 tokens > 16000 maximum`) and a generic `maximum is N`.

## 7.4 Model variants

`src/main/model-variants.ts` derives per-model reasoning-effort variants from catalog metadata
(`reasoning`, `release_date`, `reasoning_options`, `limit.output`). A variant is a **provider option
body** (`VariantBody`) merged into the request's `providerOptions`.

Effort sets are family-specific, for example:

| Family / condition | Efforts |
|---|---|
| Widely supported baseline | `low`, `medium`, `high` |
| GPT-5 family | `minimal` prepended |
| Released on/after 2025-11-13 | `none` prepended |
| Released on/after 2025-12-04 | `xhigh` appended |
| `gpt-5.1` | `none`, `low`, `medium`, `high` |
| `gpt-5.2+` | + `xhigh` |
| `gpt-5*-codex` | `low`, `medium`, `high` (+`xhigh` from `codex-max`/v2, +`none` from v3) |
| `gpt-5*-pro` | `high` (versioned pro: `medium`, `high`, `xhigh`) |
| `gpt-5*-chat` | `medium` (or none for the unversioned id) |
| `*deep-research*` | `medium` |

The renderer's `VariantPicker` calls `getAgentVariants(agentId)`; for a Codex account the list comes
from the sidecar's model catalog instead of models.dev. A variant that is no longer valid after a
model change is cleared automatically (and for Codex, `onVariantInvalidated` propagates that to the
persisted workspace record).

## 7.5 The secret vault (`vault.ts`)

Backed by Electron `safeStorage` — DPAPI on Windows, Keychain on macOS, libsecret on Linux.

```ts
isAvailable(): boolean
saveSecret(ref, secret)         // throws a [meow] error when safeStorage is unavailable
saveSecretObject(ref, obj)      // JSON.stringify + saveSecret
getSecret(ref): string | null
getSecretObject<T>(ref): T | null
hasSecret(ref) / deleteSecret(ref)
mask(secret): string            // "abcd…wxyz", or "••••" for short values
```

Storage file: `userData/connections/vault.json`, a `{ ref: base64Ciphertext }` map.

Ref conventions:

- `provider:<providerId>` — a provider API key
- `connection:codex:<accountId>` — a Codex account's OAuth token bundle

**Only the main process ever touches secrets.** The renderer receives masked values or `keyRef`s.

## 7.6 Model Connections — Codex OAuth

### Why the architecture exists

A user may connect several ChatGPT/Codex accounts. Chat requests must be routed through **exactly
the selected account**. Treating an OAuth token as an API key would make cross-account leakage a
one-line bug. Instead the app runs a loopback sidecar that gives each account its **own port and its
own local credential**, so a credential issued for account A physically cannot route through
account B.

The user's real `~/.codex/auth.json` is never read or written.

### OAuth flow (`connections/codex-oauth.ts`)

PKCE authorization code flow against `auth.openai.com`:

| Constant | Value |
|---|---|
| Client id | `app_EMoamEEZ73f0CkXaXp7hrann` (the documented Codex CLI / CLIProxyAPI identity) |
| Authorize | `https://auth.openai.com/oauth/authorize` |
| Token | `https://auth.openai.com/oauth/token` |
| Scopes | `openid profile email offline_access` |
| Redirect | `http://localhost:1455/auth/callback`, fallback `:1457` — **these exact ports are registered**; a random port is rejected with `invalid_authorize_request` |
| Callback timeout | 5 minutes |
| Bind host | `127.0.0.1` only |

The profile (`email`, `displayName`, stable `accountId`) is decoded from the ID token's claims
(`email`, `name`, `sub`).

### Account lifecycle (`connections/connections-manager.ts`)

```
connectCodex()
  → oauth.authorize()
  → vault.saveSecretObject('connection:codex:<id>', tokens)
  → store.upsert(account)         // metadata only
  → first account becomes active
  → proxy.start() or proxy.refreshAccounts()

setActive(accountId)     rejects accounts whose status !== 'ready'
disconnect(accountId)    deletes the vault secret + index entry, restarts/stops the proxy,
                         promotes another account to active if needed
getChatEndpoint(id)      synchronous; returns { baseUrl, apiKey } for the runner, and kicks a
                         background ensureFresh(); throws a [meow] error when not ready
ensureFresh(id)          refreshes the access token when it expires within 5 minutes;
                         deduped per account; failure → status 'expired'
```

`ConnectionAccount.status` ∈ `ready` | `refreshing` | `expired` | `error`.

`getActiveCodexModels()` returns `ModelRef[]` from the sidecar's model catalog, falling back to a
hardcoded list while the sidecar warms up. That fallback tracks the current CLIProxyAPI registry —
models removed upstream (e.g. `gpt-5.3-codex`, `gpt-5.2`) are rejected by the ChatGPT backend with
`model is not supported`, and image/review-only models are excluded.

### The `meow-cliproxy` sidecar

`sidecars/meow-cliproxy/` — a thin **Go** wrapper around
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT, pinned `v7.2.141`). It lives under
the CLIProxyAPI module path so it can blank-import `internal/translator`; without those translator
registrations the proxy forwards raw chat-completions bodies to the Codex backend, which answers
HTTP 400 (`{"detail":"Store must be set to false"}`) for every model.

```
meow-cliproxy --host 127.0.0.1 --port <base-port> --config <runtime-config.json> [--status <status.json>]
```

`runtime-config.json` holds `{ host, port, accounts: [{ id, credential, tokens }] }`. Account *i* is
served on `port + i`; the `--status` file maps account id → actual port.

Security properties:

- Binds `127.0.0.1` only; a non-loopback host is rejected at startup.
- One CLIProxyAPI service per account, each with exactly one allowed API key and one auth file.
  There is nothing to rotate or fall back to.
- Unknown credentials → 401.
- The runtime config (which contains OAuth tokens) lives in a **random, owner-only** directory that
  is removed on graceful shutdown; stale directories are cleaned at the next launch.

`CodexProxyManager` (`connections/codex-proxy-manager.ts`) allocates a contiguous free port range
(verifying every port in the range, up to 32 attempts), writes the runtime config, spawns the binary,
polls the status file for health with a 15s timeout, and `tree-kill`s the process on stop. Errors are
masked before surfacing: account credentials and runtime paths are replaced with `[redacted]`.

Binary location:

| Build | Path |
|---|---|
| Packaged | `<resourcesPath>/cliproxy/meow-cliproxy[.exe]` |
| Dev | `out/cliproxy/<platform>-<arch>/meow-cliproxy[.exe]` |

Built by `npm run build:cliproxy` (`scripts/build-cliproxy.mjs`); cross-compile with `GOOS`/`GOARCH`.
`electron-builder.ts` picks the directory using `CLIPROXY_PLATFORM` / `CLIPROXY_ARCH`.

### Routing a chat request through an account

`resolveAgentConfig` short-circuits when `providerName === 'codex' && accountId`:

```ts
const endpoint = connections.getChatEndpoint(accountId)   // { baseUrl: http://127.0.0.1:<port>/v1,
                                                          //   apiKey: <per-account local credential> }
return { provider: 'codex', model, apiKey: endpoint.apiKey, baseUrl: endpoint.baseUrl, systemPrompt }
```

This branch runs **before** the `meow.json` provider lookup, so a connected account works even when
no `codex` provider entry exists in the config. From there it is an ordinary OpenAI-compatible
request.

### Not yet enabled

Claude Code and Antigravity OAuth adapters are not shipped in this release. The
provider/account architecture (`ConnectionProviderId`, `ConnectionStore`, `ConnectionsManager`) is
already generic enough to take them — `ConnectionProviderId` is currently `'codex'` only.

## 7.7 Cost accounting

`agent/usage.ts` `calcCost(usage, price)` with per-model prices supplied to `MeowAgentManager` as
`prices: Record<'<provider>/<model>', { input?, output?, cacheRead?, cacheWrite? }>`.

- Every step reports usage (`onUsage`), so an interrupted turn still records what it spent.
- Subagent usage is billed to the parent session but priced at the **subagent's own model**, and it
  does not overwrite `lastUsageByAgent` (which drives the parent's overflow check).
- `getStats()` aggregates `totalCost`, `totalTokens`, `perModel`, and `perSession`.
  `totalTokens` deliberately includes cache read/write tokens so the numbers match provider
  dashboards.
- `sessionTokens.input` in the `usage` `ChatEvent` likewise includes cached tokens (matching, e.g.,
  DeepSeek's `prompt_tokens = cache hit + miss`).
