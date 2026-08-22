# Cloudflare boundary

Use current Cloudflare documentation and installed package schemas before writing configuration.

- A standard Worker handles signed HTTP interactions and state coordination; it does not host Discord's long-lived UDP voice process.
- A Durable Object owns serialized per-deployment desired/observed state, replay protection, command receipts, and the authenticated agent WebSocket.
- D1 stores durable configuration and redacted audit records. Keep message bodies, tokens, signatures, and authorization headers out of it.
- A Container-hosted voice agent is accepted only after live outbound DNS/HTTPS, Gateway WebSocket, UDP send/receive, IP discovery, DAVE, restart, lifecycle, and SIGTERM tests.
- If the Container proof fails, preserve the Worker/DO/D1 control plane and report the voice host blocked or use an explicitly authorized persistent host adapter.
- Keep the bot token in the voice-host trust boundary. The public control Worker must not receive it.
