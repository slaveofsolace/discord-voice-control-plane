# Threat model

## Protected assets

- Discord bot token, client secret, agent HMAC keys, and internal-status secret.
- Control authority, exact target authorization, and managed-room ownership.
- Member privacy and the absence of captured voice or relay content.
- Audit integrity and deployment isolation.

## Main threats and controls

| Threat                           | Control                                                                                                                                 | Remaining gate                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Forged Discord request           | Ed25519 over the raw body before parsing; five-minute timestamp bound                                                                   | Workers integration test; live Discord ping pending |
| Unauthorized operator            | Fixed application, guild, channel, user, and role allowlists; separate elevated list                                                    | Private guild denial tests pending                  |
| Arbitrary target join            | `/vc join` has no target input; target is stored only by authorized administration                                                      | Live target test pending                            |
| Forged or replayed agent command | Versioned HMAC-SHA256, current/previous `kid`, 30-second expiry, five-minute nonce store                                                | Unit tested; live rotation pending                  |
| Duplicate side effect            | 24-hour Durable Object and D1 receipts; in-process agent receipt replay                                                                 | Process-crash edge remains an integration gate      |
| Relay abuse                      | NFC, 1,000-character cap, control and bidi rejection, prefix rejection, empty mentions, 5/operator/minute and 20/deployment/minute      | Unit tested; Discord 429 test pending               |
| Guild-wide moderation            | No Kick Members, Ban Members, Administrator, Manage Guild, or Manage Webhooks request                                                   | Permission inspection pending                       |
| Third-party room takeover        | External rooms are absent from managed-room records and reject member commands                                                          | Test-guild and Socialize observation pending        |
| Secret disclosure                | Separate Workers, protected secret prompts, redaction, ignored runtime logs, repository scanner                                         | Cloudflare binding inspection pending               |
| Voice surveillance               | Self-deaf, self-mute, no receiver subscription, no audio player, no recording or transcription dependency                               | Source checked; live behavior pending               |
| Endless reconnect after removal  | Moderator move/disconnect, 4014, permission loss, deletion, auth failure, repeated DAVE failure, and retry exhaustion block the circuit | Unit state tests; live moderation test pending      |
| Cross-tenant access              | Deployment ID in DO name, envelope, bootstrap, and every stored configuration record                                                    | V1 is single tenant; hosted review deferred         |

## Excluded behavior

No user token, self-bot, CAPTCHA handling, third-party command invocation, synthetic activity, raw voice processing, arbitrary channel management, billing automation, or credential display automation is in scope.
