# Codex OAuth accounts & local proxy

This release adds multi-account Codex (ChatGPT) OAuth to Meow Coding.

## What's new

- **Connect multiple Codex accounts** in **Settings → Providers → Codex (ChatGPT OAuth)**.
  Signing in runs the standard PKCE authorization-code flow in your system browser and stores
  OAuth tokens only in the encrypted OS keychain (Electron `safeStorage`).
- **Pick the active account** with one click; only the active account's models appear in the
  native-chat **model picker**, grouped under the account label.
- **Chat runs through a local, account-scoped proxy** (`meow-cliproxy`). Each account gets its own
  local credential and its own loopback port, so a credential issued for account A can never be
  used to route a request through account B. The proxy only listens on `127.0.0.1`.
- **Disconnect** removes the account's secrets and metadata and reloads the proxy.

## Where data lives

- Non-secret account metadata: `userData/connections/index.json`.
- OAuth tokens: encrypted Vault (`userData/connections/vault.json` via safeStorage). Never stored
  in `meow.json` or sent to the renderer.
- Proxy runtime material: `userData/connections/runtime/run-<random>/` — removed on graceful
  shutdown, stale directories cleaned at next launch.
- Your real `~/.codex/auth.json` is never read, imported, or overwritten.

## Attribution

The bundled `meow-cliproxy` sidecar wraps [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
(pinned at `v7.1.22`), MIT licensed; the license notice ships in the app as
`resources/third-party/CLIProxyAPI-LICENSE` and is included in every release.

## Not in this release

Claude Code and Antigravity OAuth flows are not enabled yet; the provider/account architecture
leaves room for their adapters without changing the API-key provider flows.
