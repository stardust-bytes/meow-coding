# Remote Control (Mobile)

Desktop and phone both connect **outbound** to a self-hosted WebSocket relay, so no ports or NAT
config are needed on either side. The relay only routes opaque messages between a single paired
desktop–mobile pair and stores nothing; it never interprets payloads. Trust is established by a
6-digit pairing code shown on the desktop (TTL ~5 min) — the phone redeems it for a long-lived
session token it stores for future connections, and the desktop can revoke it at any time. Every
command from the phone goes through a safety gate: remote control must be explicitly enabled, and
only read-only operations plus `chat:send` (session create/switch/rename) are exposed.

## Run the relay

```
cd server
npm install
npm start
```

Listens on `0.0.0.0:3928` (override with the `PORT` env var). Always put it behind a TLS reverse
proxy before exposing it to the internet — see `server/README.md` for the Caddy example.

## Enable remote control on the desktop

1. Open **Settings → Remote Control**.
2. Toggle **Allow remote control** on.
3. Enter the relay URL (`wss://relay.example.com`) in the **Relay URL** field.
4. Click **Start pairing** and note the 6-digit code (or the "paired" state if the phone
   reconnects with its saved token).
5. Enter the code in the mobile app to complete pairing.

The mobile app itself is a later plan — it will consume the same protocol against this relay.

## Spec & plan

- Design spec: `docs/superpowers/specs/2026-08-19-mobile-remote-control-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-19-mobile-remote-control.md`
