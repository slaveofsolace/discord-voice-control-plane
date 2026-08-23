# Completion audit

Audited against the authorized Discord user-relay completion goal on 2026-08-22. Source, CI, private-lab, OAuth, Cloudflare, and target-guild evidence are distinct.

## Verdict

The reusable source implementation is complete at the local test level. It now includes private relay intake, dedicated authenticated Cloudflare ingress, redacted persistence, an encrypted per-profile local approval queue, a secured loopback dashboard, documented Discord RPC preparation, and the human final-send boundary.

Live completion is `PARTIAL`. Protected Discord grants, a verified `main` RPC profile, live private-lab behavior, Cloudflare deployment, Container proof, rollback exercise, and Socialize staff authority remain external gates. Socialize is untouched.

## Requirement matrix

| Requirement                 | Evidence                                                                                                                    | Verdict              | Remaining action                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| Preserve inherited RPC work | Recovery patch and untracked hash manifest stored outside tracked source; first checkpoint `db74bed`                        | `PROVEN CURRENT`     | Retain recovery directory until delivery accepted  |
| Private bot intake          | Exact application/guild/channel/operator/elevated checks and negative event filters                                         | `UNIT TESTED`        | Complete protected bot install and denial matrix   |
| Command grammar             | Ordinary text plus every exact `!voice`/`!v` form, boundary, alias, argument, and risk                                      | `UNIT TESTED`        | Exercise all risk classes in lab                   |
| Authenticated relay ingress | Separate HMAC, freshness, one-time nonces for create/status/cancel, constant-time MAC, exact context, idempotency, body cap | `INTEGRATION TESTED` | Deploy with real secret and inspect live rejection |
| Offline privacy             | Worker checks the authorized local agent and retains no body when offline                                                   | `INTEGRATION TESTED` | Observe live offline response                      |
| Redacted cloud state        | D1 and Durable Object tests keep execution state body-free and expire relay/audit metadata                                  | `INTEGRATION TESTED` | Inspect deployed D1 schema/rows                    |
| Encrypted local queue       | AES-256-GCM per profile, atomic backup recovery, TTL, cap, FIFO, terminal purge                                             | `UNIT TESTED`        | Live restart/tamper recovery                       |
| Dashboard security          | Loopback-only, exact Host/Origin, authenticated SameSite session, CSRF, CSP, body cap                                       | `UNIT TESTED`        | Human review in private lab                        |
| Manual preparation          | Prepare-time identity/RPC/target-revision/voice/state/TTL checks and fixed `clip.exe` handoff                               | `UNIT TESTED`        | Owner performs one manual paste/send               |
| Delivery semantics          | Status lifecycle and no `target_message_id`; owner confirmation is not delivery proof                                       | `UNIT TESTED`        | Independently inspect one sent lab message         |
| Profile isolation           | `main` preserved; separate profile/key/queue/lock; target/profile change invalidation                                       | `UNIT TESTED`        | Manually authorize and verify `main`               |
| Forbidden paths absent      | Source-negative tests cover raw token, user Gateway, send API, UI keystrokes, PowerShell clipboard, audio, keepalive        | `UNIT TESTED`        | Preserve in future reviews                         |
| Reusable official-bot path  | Managed rooms, slash/prefix commands, silent DAVE voice state, host/probe adapters retained                                 | `UNIT TESTED`        | Live official-bot and Container proof              |
| Relay deployment adapter    | Typed argument builders forward the exact relay identity, allowlists, relay-only mode, and ingress URL to both Workers      | `UNIT TESTED`        | Deploy with real protected configuration           |
| Credential handoff          | Validated repository and installed skill prepares a hidden TTY, user-only file, redacted verification, and owner handoff    | `VALIDATED`          | Owner enters the two protected Discord values      |
| Public wording and security | 24-file copy triage, Anti-AI scan, 158-file secret scan, dependency audit, ledger validation, and diff check passed         | `VALIDATED`          | Repeat these gates for later changes               |
| Publication                 | Prior public checkpoint `3d3309aba112303b5dd7d400da2b21daf8b2010b` passed exact-SHA CI run `32614534096`                    | `VALIDATED`          | Publish current commits only after fresh gates     |
| Socialize                   | No bot install, authorization, join, message, modification, or measurement                                                  | `BLOCKED`            | Staff intake plus supported persistence/exemption  |

## Evidence boundaries

- `UNIT TESTED`: contracts, grammar, intake authorization, queue encryption/recovery, dashboard security, profile isolation, preparation boundaries, source-negative assertions, copy, secret, dependency, and ledger checks.
- `INTEGRATION TESTED`: Worker routing, ingress HMAC/replay/idempotency, local-agent liveness, D1 migrations, Durable Object state, cancellation, and redacted persistence.
- `UNVERIFIED`: protected Discord configuration, live OAuth identity, local dashboard use, RPC join/leave, actual Discord delivery, Worker deployment, D1 runtime, Container network/DAVE/lifecycle, and rollback.
- `BLOCKED`: Socialize staff window, exact targets, contacts, and supported persistent-room or timeout-exemption mechanism.

## External gates

Workers Paid was observed as active, so no further payment step is presently identified. This does not prove deployment.

A prior “auth granted” message was not tied to a verified, profile-bound `main` RPC identity and exact target. No protected profile content was opened for this audit. The earlier staged seven-permission Voice Rooms consent is obsolete. The owner confirmed the locked four-permission Voice Rooms installation, and the Developer Portal displayed `Bot successfully updated!` after Message Content was enabled. The bot token, VC Control client secret, command registration, and live relay remain unverified.

Wrangler 4.125.0 is authenticated to the selected account. The control Worker passes a complete dry run, and the voice-host and probe Workers pass configuration dry runs with Container rollout disabled. None of the three Workers has a deployment. Docker is absent, so Wrangler cannot build either Container image locally and no Container runtime claim is supported.

The next live phase starts in the private lab. `$discord-secret-handoff` opens the exact page, prepares the hidden user-only prompt, and verifies identity without revealing values. Login, MFA, CAPTCHA, credential creation/revelation/copying, permission confirmation, and OAuth approval remain manual.

If approved target observation later establishes that ordinary authorized-member presence is insufficient and staff supplies no supported persistent or exempt configuration, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
