# Threat model

## Protected assets

- Discord bot token, client secret, agent HMAC keys, and internal-status secret.
- Control authority, exact target authorization, managed-room ownership, and tenant/deployment separation.
- Member privacy and the absence of captured voice or stored relay content.
- Audit integrity and recoverable control state.

## Main threats and controls

| Threat                                  | Control                                                                                                                                                        | Remaining gate                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Forged Discord request                  | Ed25519 over the raw body before parsing; five-minute timestamp bound                                                                                          | Workers integration tested; live Discord ping pending    |
| Unauthorized operator                   | Fixed application, guild, channel, user, and role allowlists; separate elevated list                                                                           | Private-guild denial tests pending                       |
| Arbitrary target join                   | `/vc join` has no target input; target is stored only by authorized administration                                                                             | Live target test pending                                 |
| Cross-tenant or cross-deployment access | Tenant and deployment IDs are checked at bootstrap, command, Durable Object, heartbeat, configuration, and persistence boundaries                              | V1 is single-tenant; hosted-service review deferred      |
| Forged or replayed agent command        | Versioned HMAC-SHA256, current/previous `kid`, 30-second expiry, five-minute nonce store                                                                       | Unit tested; live rotation pending                       |
| Duplicate relay after retry             | 24-hour receipts plus Discord `nonce` with `enforce_nonce`; non-relay state snapshots are coalesced and bounded while offline                                  | Discord delivery/retry observation pending               |
| Lost D1 state after transient failure   | Ordered Durable Object `state_outbox`, alarm retry, and bounded storage; audit uses a separate ordered outbox                                                  | Migration-backed recovery tested; live D1 outage pending |
| Relay abuse                             | NFC, 1,000-character cap, control and bidi rejection, prefix rejection, empty mentions, 5/operator/minute and 20/deployment/minute                             | Unit tested; Discord 429 observation pending             |
| Guild-wide moderation                   | No Kick Members, Ban Members, Administrator, Manage Guild, or Manage Webhooks request                                                                          | Permission inspection pending                            |
| Third-party room takeover               | External targets stay `presence_only`; managed rooms require deployment enablement and exact managed-guild allowlisting                                        | Test-guild and Socialize observation pending             |
| Secret disclosure                       | Separate Workers, protected secret prompts, redaction, ignored runtime logs, repository scanner                                                                | Cloudflare binding inspection pending                    |
| Voice surveillance                      | Self-deaf, self-mute, no receiver subscription, audio player, recording, transcription, Opus, or FFmpeg dependency                                             | Source checked; live behavior pending                    |
| Endless reconnect after removal         | Moderator move/disconnect, 4014, permission loss, deletion, invalid authorization, auth failure, repeated DAVE failure, and retry exhaustion block the circuit | Unit state tests; live moderation test pending           |
| False voice-readiness claim             | `CONNECTED` requires voice ready plus observed DAVE; probe separately gates UDP discovery, rejoin, reauthentication, stability, SIGTERM, and two run IDs       | Live Container probe pending                             |

## Excluded behavior

No user token, self-bot, CAPTCHA handling, third-party command invocation, synthetic activity, raw voice processing, arbitrary channel management, billing automation, or credential display automation is in scope.
