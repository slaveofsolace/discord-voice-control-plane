# Threat model

## Protected assets

- Discord bot, application, OAuth, dashboard, ingress, and agent credentials.
- Exact control guild, relay channel, operator, target, tenant, deployment, and RPC-user authorization.
- Pending relay content and the absence of cloud content retention.
- Member privacy, silent voice behavior, and the human final-send boundary.
- Audit integrity and recoverable queue/control state.

## Main threats and controls

| Threat                         | Control                                                                                                                     | Remaining gate                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Forged Discord interaction     | Raw-body Ed25519 verification, bounded body, timestamp and exact control context checks                                     | Live Discord ping unverified                       |
| Forged relay ingress           | Separate HMAC, constant-time verification, 30-second freshness, nonce replay storage, exact context schema                  | Live private-bot ingress unverified                |
| Duplicate Gateway delivery     | Deterministic request ID from deployment, application, and source message plus durable idempotency                          | Live reconnect unverified                          |
| Unauthorized operator          | Exact user/role allowlists; separate elevated user/role allowlists; originator/elevated cancel rule                         | Private-lab denial matrix unverified               |
| Unsafe relay content           | NFC, 1,000-character cap, C0/C1 and bidi rejection, slash/unknown-command/ordinary-mention rejection, exact command grammar | Unit tested                                        |
| Cloud content disclosure       | Offline requests rejected before retention; D1 stores only hash, length, routing metadata, state, and result                | Live D1 inspection unverified                      |
| Queue disclosure or tamper     | Per-profile AES-256-GCM key, authenticated ciphertext, current-user storage, atomic backup recovery                         | Unit tested                                        |
| Cross-profile retargeting      | Separate profile file/key/queue, one active profile per deployment, target/profile change cancels nonterminal requests      | Unit tested                                        |
| Wrong Discord account          | OAuth identity and expected-user checks at startup and prepare time                                                         | Verified `main` profile pending                    |
| Automatic user send            | No user Gateway, raw token, send-message API, paste/Enter synthesis, or UI control; fixed `clip.exe` preparation only       | Source-negative tests pass; live manual UX pending |
| False delivery claim           | Manual path never sets `target_message_id`; `OWNER_CONFIRMED_SENT` is explicitly a human receipt                            | Independent delivery observation pending           |
| Stale or wrong target          | Prepare rechecks profile, authorization, RPC, exact voice selection, exact text target, TTL, and state                      | Live moderation test pending                       |
| Local web attack               | Loopback bind, exact Host/Origin, SameSite session, CSRF, CSP, no CORS/assets, bounded bodies                               | Unit tested                                        |
| Voice surveillance or activity | No receiver, recording, transcription, audio output, synthetic mic, scheduler, or keepalive path                            | Source checked; live transport unverified          |
| Third-party room takeover      | Socialize untouched; no bot install, managed-room adoption, third-party commands, or arbitrary target input                 | Staff approval/target blocked                      |
| False retention claim          | No anti-AFK design; deletion behavior requires staff-approved passive observation and supported exemption evidence          | Blocked                                            |

## Excluded behavior

No user token, user Gateway, self-bot, automatic normal-user message, Discord UI keystroke, CAPTCHA handling, credential automation, third-party command invocation, synthetic activity, raw voice processing, scheduled keepalive, arbitrary target management, or billing automation is in scope.
