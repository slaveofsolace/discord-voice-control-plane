# Threat model

## Protected assets

- Discord bot token, client secret, agent HMAC keys, and internal-status secret.
- Control authority, exact target authorization, managed-room ownership, and tenant/deployment separation.
- Member privacy and the absence of captured voice or stored relay content.
- Audit integrity and recoverable control state.

## Main threats and controls

| Threat                                       | Control                                                                                                                                                                                                                | Remaining gate                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Forged or replayed Discord request           | Complete runtime schema; structural signature check; 64 KiB streaming body cap; Ed25519 over the raw body before parsing; five-minute timestamp bound; durable 24-hour mutating-interaction claim                      | Workers integration tested; live Discord ping pending    |
| Unauthorized operator                        | Fixed application, guild, channel, user, and role allowlists; separate elevated list                                                                                                                                   | Private-guild denial tests pending                       |
| Arbitrary target join                        | `/vc join` has no target input; target is stored only by authorized administration                                                                                                                                     | Live target test pending                                 |
| Cross-tenant or cross-deployment access      | Tenant and deployment IDs are checked at bootstrap, command, Durable Object, heartbeat, configuration, and persistence boundaries                                                                                      | V1 is single-tenant; hosted-service review deferred      |
| Forged, replayed, or duplicate agent command | Versioned HMAC-SHA256, distinct current/previous keys, 30-second expiry, five-minute nonce store, durable pre-effect executing ledger, and 24-hour receipts                                                            | Unit/integration tested; live rotation pending           |
| Duplicate relay after retry                  | 24-hour receipts plus Discord `nonce` with `enforce_nonce`; non-relay state snapshots are coalesced and bounded while offline                                                                                          | Discord delivery/retry observation pending               |
| Lost D1 state or audit evidence              | State snapshots coalesce by object key; permanent conflicts dead-letter and block bootstrap; audit capacity fails new commands closed; alarms retry transient failures                                                 | Migration-backed recovery tested; live D1 outage pending |
| Relay abuse                                  | NFC, 1,000-character cap, control and bidi rejection, prefix rejection, empty mentions, 5/operator/minute and 20/deployment/minute                                                                                     | Unit tested; Discord 429 observation pending             |
| Guild-wide moderation                        | No Kick Members, Ban Members, Administrator, Manage Guild, or Manage Webhooks request                                                                                                                                  | Permission inspection pending                            |
| Third-party room takeover                    | External targets stay `presence_only`; every managed-room action rechecks enablement/profile/allowlist; guild serialization enforces owner uniqueness; bot-owned ACL bits stop on staff conflict                       | Test-guild and Socialize observation pending             |
| Secret disclosure                            | Separate control/voice Workers, one voice-token Worker boundary, protected prompts, redaction, ignored fallback env, deny-by-default Docker context, repository scanner                                                | Cloudflare binding inspection pending                    |
| Voice surveillance                           | Self-deaf, self-mute, no receiver subscription, audio player, recording, transcription, Opus, or FFmpeg dependency                                                                                                     | Source checked; live behavior pending                    |
| Endless or stale-target reconnect            | Connection-attempt epochs stop an in-flight stale join; moderator move/disconnect, 4014, permission loss, deletion, invalid authorization, auth failure, repeated DAVE failure, and retry exhaustion block the circuit | Unit state tests; live moderation test pending           |
| False voice-readiness claim                  | `CONNECTED` requires voice ready plus observed DAVE; probe separately gates UDP discovery, rejoin, reauthentication, stability, SIGTERM, and two run IDs                                                               | Live Container probe pending                             |

## Excluded behavior

No user token, self-bot, CAPTCHA handling, third-party command invocation, synthetic activity, raw voice processing, arbitrary channel management, billing automation, or credential display automation is in scope.
