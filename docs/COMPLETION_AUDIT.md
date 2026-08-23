# Completion audit

Audited against the authorized Discord user-relay completion goal on 2026-08-22. Source, CI, private-lab, OAuth, Cloudflare, and target-guild evidence are distinct.

## Verdict

The reusable source implementation is complete at the local test level. It now includes private relay intake, dedicated authenticated Cloudflare ingress, redacted persistence, an encrypted per-profile local approval queue, a secured loopback dashboard, documented Discord RPC preparation, and the human final-send boundary.

Live completion is `PARTIAL`. Protected Discord grants, a verified `main` RPC profile, live private-lab behavior, Cloudflare deployment, Container proof, rollback exercise, and Socialize staff authority remain external gates. Socialize is untouched.

## Requirement matrix

| Requirement                 | Evidence                                                                                                             | Verdict              | Remaining action                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| Preserve inherited RPC work | Recovery patch and untracked hash manifest stored outside tracked source; first checkpoint `db74bed`                 | `PROVEN CURRENT`     | Retain recovery directory until delivery accepted  |
| Private bot intake          | Exact application/guild/channel/operator/elevated checks and negative event filters                                  | `UNIT TESTED`        | Complete protected bot install and denial matrix   |
| Command grammar             | Ordinary text plus every exact `!voice`/`!v` form, boundary, alias, argument, and risk                               | `UNIT TESTED`        | Exercise all risk classes in lab                   |
| Authenticated relay ingress | Separate HMAC, freshness, nonce, constant-time MAC, exact context, idempotency, body cap                             | `INTEGRATION TESTED` | Deploy with real secret and inspect live rejection |
| Offline privacy             | Worker checks the authorized local agent and retains no body when offline                                            | `INTEGRATION TESTED` | Observe live offline response                      |
| Redacted cloud state        | D1 migration and tests store hash/length/source/actor/status/results only                                            | `INTEGRATION TESTED` | Inspect deployed D1 schema/rows                    |
| Encrypted local queue       | AES-256-GCM per profile, atomic backup recovery, TTL, cap, FIFO, terminal purge                                      | `UNIT TESTED`        | Live restart/tamper recovery                       |
| Dashboard security          | Loopback-only, exact Host/Origin, authenticated SameSite session, CSRF, CSP, body cap                                | `UNIT TESTED`        | Human review in private lab                        |
| Manual preparation          | Prepare-time identity/RPC/target/voice/state/TTL checks and fixed `clip.exe` handoff                                 | `UNIT TESTED`        | Owner performs one manual paste/send               |
| Delivery semantics          | Status lifecycle and no `target_message_id`; owner confirmation is not delivery proof                                | `UNIT TESTED`        | Independently inspect one sent lab message         |
| Profile isolation           | `main` preserved; separate profile/key/queue/lock; target/profile change invalidation                                | `UNIT TESTED`        | Manually authorize and verify `main`               |
| Forbidden paths absent      | Source-negative tests cover raw token, user Gateway, send API, UI keystrokes, PowerShell clipboard, audio, keepalive | `UNIT TESTED`        | Preserve in future reviews                         |
| Reusable official-bot path  | Managed rooms, slash/prefix commands, silent DAVE voice state, host/probe adapters retained                          | `UNIT TESTED`        | Live official-bot and Container proof              |
| Public wording and security | Copy triage, Anti-AI scan, 156-file secret scan, dependency audit, ledger validation, and diff check passed          | `VALIDATED`          | Complete immutable-range security scan before push |
| Publication                 | Local `main` is ahead with two focused commits                                                                       | `PENDING`            | Final docs commit, push, exact-SHA CI              |
| Socialize                   | No bot install, authorization, join, message, modification, or measurement                                           | `BLOCKED`            | Staff intake plus supported persistence/exemption  |

## Evidence boundaries

- `UNIT TESTED`: contracts, grammar, intake authorization, queue encryption/recovery, dashboard security, profile isolation, preparation boundaries, source-negative assertions, copy, secret, dependency, and ledger checks.
- `INTEGRATION TESTED`: Worker routing, ingress HMAC/replay/idempotency, local-agent liveness, D1 migrations, Durable Object state, cancellation, and redacted persistence.
- `UNVERIFIED`: protected Discord configuration, live OAuth identity, local dashboard use, RPC join/leave, actual Discord delivery, Worker deployment, D1 runtime, Container network/DAVE/lifecycle, and rollback.
- `BLOCKED`: Socialize staff window, exact targets, contacts, and supported persistent-room or timeout-exemption mechanism.

## External gates

Workers Paid was observed as active, so no further payment step is presently identified. This does not prove deployment.

A prior “auth granted” message was not tied to a verified, profile-bound `main` RPC identity and exact target. No protected profile content was opened for this audit. The earlier staged seven-permission Voice Rooms consent is obsolete; relay-only mode uses the four-permission private profile.

The next live phase starts in the private lab. Login, MFA, CAPTCHA, credential display/copying, privileged-intent toggling, permission confirmation, and OAuth approval remain manual.

If approved target observation later establishes that ordinary authorized-member presence is insufficient and staff supplies no supported persistent or exempt configuration, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
