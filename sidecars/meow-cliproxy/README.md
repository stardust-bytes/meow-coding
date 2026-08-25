# meow-cliproxy

App-owned sidecar that runs one account-scoped, OpenAI-compatible proxy per Codex
OAuth account. It is a thin Go wrapper around
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT, pinned at
`v7.2.141`; license notice in `resources/third-party/CLIProxyAPI-LICENSE`).

The module lives under the CLIProxyAPI module path
(`github.com/router-for-me/CLIProxyAPI/v7/meow-cliproxy`) so it can blank-import
the `internal/translator` package — without those translator registrations the
proxy forwards raw chat-completions bodies to the Codex backend, which answers
HTTP 400 (`{"detail":"Store must be set to false"}`) for every model.

## Why

Meow Coding lets users connect multiple ChatGPT/Codex accounts via OAuth and pick
one active account for native chat. Chat requests must only ever be routed
through the selected account. Instead of treating OAuth tokens as an OpenAI API
key, the app runs this sidecar on loopback: each account gets its own local
credential and its own loopback port, so a credential issued for account A can
never be used to route a request through account B.

## Security model

- Binds to `127.0.0.1` only (loopback host validated at startup; non-loopback
  hosts are rejected).
- One CLIProxyAPI service per account, each on a distinct port with exactly one
  allowed API key and exactly one auth file. There is nothing to rotate or fall
  back to: a request is served by exactly the account it authenticates to.
- Unknown credentials are rejected with 401.
- The runtime config (which contains the OAuth tokens) lives in a random,
  owner-only runtime directory that is removed on graceful shutdown and cleaned
  up by the app at next launch.

## Usage

```
meow-cliproxy --host 127.0.0.1 --port <base-port> --config <runtime-config.json> [--status <status.json>]
```

`runtime-config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 43100,
  "accounts": [
    {
      "id": "acct-a",
      "credential": "local-credential-for-a",
      "tokens": {
        "accessToken": "...",
        "refreshToken": "...",
        "idToken": "...",
        "accessTokenExpiresAt": "2026-08-26T00:00:00.000Z"
      }
    }
  ]
}
```

Each account is served on `port + index`. The `--status` file maps account id to
the actual port.

## Build

From the repository root:

```
npm run build:cliproxy
```

Output goes to `out/cliproxy/<os>-<arch>/meow-cliproxy[.exe]`.
Cross-compile with `GOOS`/`GOARCH` env vars.
