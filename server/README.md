# Meow Relay

WebSocket relay for the Meow mobile remote control. Routes messages between a
single desktop client and a single mobile client; message payloads are opaque.

## Run

```
npm install
npm start
```

Listens on `0.0.0.0:3928` (override with the `PORT` env var).

## Deploy on a VPS

Put it behind a TLS reverse proxy, e.g. Caddy:

```
meow-relay.example.com {
    reverse_proxy 127.0.0.1:3928
}
```

## Security

The relay sees every message payload (no E2E encryption yet). Intended for a
single desktop–mobile pair. Pairing is validated by the desktop client, not the
relay.
