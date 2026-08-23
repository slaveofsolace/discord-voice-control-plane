# Test evidence

Raw execution logs remain under ignored `.runtime`. This file contains sanitized proof boundaries.

## Labels

- `UNIT TESTED`: deterministic local test.
- `INTEGRATION TESTED`: multiple components under the local or Workers test runtime.
- `LIVE TEST-GUILD VERIFIED`: observed in `VC Control Lab`.
- `LIVE LOCAL RPC VERIFIED`: observed through an exact OAuth profile/user/target binding.
- `TARGET-GUILD VERIFIED`: observed during a staff-approved target window.
- `UNVERIFIED`: not observed at that level.
- `BLOCKED`: an external prerequisite prevents the proof.

## Current source checkpoint

| Gate                               | Result               | Sanitized evidence                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, lint, typecheck, build | `UNIT TESTED`        | Prettier, typed ESLint, strict TypeScript, and all workspace builds passed after the relay implementation                                                                                                                                                                                           |
| Package tests                      | `UNIT TESTED`        | 170 tests across 30 files passed                                                                                                                                                                                                                                                                    |
| Deployment variables               | `UNIT TESTED`        | Control and voice-host argument builders forward the exact relay application, guild, channel, operator/elevated allowlists, relay-only state, and ingress endpoint; missing or inconsistent relay configuration fails closed                                                                        |
| Workers tests                      | `INTEGRATION TESTED` | 23 migration-backed Worker, Durable Object, D1, interaction, relay-ingress, replay, idempotency, offline, cancellation, and recovery tests passed                                                                                                                                                   |
| Relay intake                       | `UNIT TESTED`        | Exact guild/channel/application/operator/elevated authorization; bot, webhook, edit, attachment, embed, thread, and empty-message denial                                                                                                                                                            |
| Content grammar                    | `UNIT TESTED`        | Ordinary text NFC/length/control/bidi/slash/mention checks; every `!voice` and `!v` form, boundary, alias, user argument, and risk class                                                                                                                                                            |
| Relay ingress                      | `INTEGRATION TESTED` | Separate HMAC, timestamp, nonce replay for create/status/cancel, tamper, oversized body, source-message idempotency, context revalidation, offline no-retention, and cancellation                                                                                                                   |
| Local encrypted queue              | `UNIT TESTED`        | AES-GCM confidentiality/integrity, atomic recovery, restart, TTL, cap, FIFO, cancellation, terminal purge, profile/target/deployment validation                                                                                                                                                     |
| Local dashboard                    | `UNIT TESTED`        | Loopback binding, Host/Origin/session/CSRF/CSP/body limits, unauthorized mutations, lifecycle actions, and no CORS/remote assets                                                                                                                                                                    |
| Prepare boundary                   | `UNIT TESTED`        | Prepare-time OAuth/account/RPC/voice/text/TTL/state and target-revision revalidation, including forced target-change interleaving, plus bounded fixed-path `clip.exe` success/failure/timeout                                                                                                       |
| Profile isolation                  | `UNIT TESTED`        | Separate profile key/queue, one active deployment profile, wrong-user blocking, non-overwrite authorization                                                                                                                                                                                         |
| Protected credential handoff       | `VALIDATED`          | Repository and installed `$discord-secret-handoff` copies pass the skill validator, match by SHA-256 per file, open only the exact page and hidden TTY, and forbid credential revelation/copy automation or value inspection                                                                        |
| Status semantics                   | `UNIT TESTED`        | Full status lifecycle, elevated risk, human receipt semantics, and no manual-path `target_message_id`                                                                                                                                                                                               |
| Source-negative checks             | `UNIT TESTED`        | No raw user-token path, user Gateway, user-account send API, Discord UI keystroke, PowerShell clipboard, synthetic audio, scheduled activity, or keepalive path                                                                                                                                     |
| Secret and dependency scans        | `UNIT TESTED`        | Secret scan passed across 158 tracked/untracked candidates; `pnpm audit --audit-level high` reported no known vulnerabilities                                                                                                                                                                       |
| Copy and reasoning checks          | `UNIT TESTED`        | Project copy triage passed across 24 files, the Anti-AI scanner found zero candidates, and the Human Cortex ledger passed schema 2.0.0 validation                                                                                                                                                   |
| Exact-SHA GitHub CI                | `VALIDATED`          | The prior public checkpoint `3d3309aba112303b5dd7d400da2b21daf8b2010b` passed CI run `32614534096`; the current relay-deployment and skill commits require a fresh exact-SHA run before release                                                                                                     |
| Discord private resources          | `PARTIAL`            | The lab server, channels, and applications were observed. The owner confirmed the locked four-permission Voice Rooms install, and Message Content was saved with a Developer Portal success confirmation. Credentials, commands, and live relay remain unverified                                   |
| Verified `main` RPC profile        | `UNVERIFIED`         | No profile-bound OAuth/RPC identity and target proof exists in committed evidence; the earlier “auth granted” statement is insufficient                                                                                                                                                             |
| Cloudflare readiness               | `PARTIAL`            | Wrangler 4.125.0 is OAuth-authenticated with Workers, D1, and Containers access. Control dry-run passed; voice-host and probe Worker-only dry-runs passed with Container rollout disabled. All three deployment counts were zero. Docker is absent, so image build and runtime proof remain blocked |
| Socialize                          | `BLOCKED`            | Untouched; no staff window, exact target, contacts, verified RPC profile, or supported persistence/exemption mechanism                                                                                                                                                                              |

The prior public checkpoint `3d3309aba112303b5dd7d400da2b21daf8b2010b` passed exact-SHA CI run `32614534096`. The current local relay-deployment fix adds four deterministic tests, bringing the package suite to 170. Formatting, lint, strict typecheck, all builds, package and Worker tests, 24-file copy triage, 158-file secret scan, dependency audit, Anti-AI scan, ledger and skill validation, installed-skill hash comparison, and diff check pass. The first immutable review's six low-severity findings remain remediated. A fresh diff security review, push, and exact-SHA CI run are still required. Test counts and dry runs do not prove live Discord, voice, OAuth, Cloudflare, or target behavior.

## Private-lab acceptance matrix

- Capture the protected Voice Rooms bot token and VC Control client secret through the hidden local prompt; the locked installation and Message Content setting are owner-confirmed.
- Complete a verified `main` OAuth profile manually while Discord desktop is signed into the intended account.
- Join and leave `voice-probe` using the exact stored RPC target.
- Queue ordinary chat, operator commands, and elevated commands.
- Verify wrong guild, channel, application, user, role, and elevated denial.
- Verify bots, webhooks, edits, attachments, embeds, threads, empty messages, mentions, control/bidi text, slash text, and unknown commands do not queue.
- Verify status and cancellation do not reveal content and only the originator or elevated operator may cancel.
- Restart the local agent and Discord desktop; confirm queue recovery and wrong-account blocking.
- Prepare one request, manually paste/send it, mark it sent, and independently inspect Discord. Record preparation, owner confirmation, and delivery as three separate observations.
- Exercise OAuth revocation, ingress/agent key rotation, queue recovery, emergency stop, process shutdown, and rollback.

## Cloudflare Container proof

Two different probe run IDs must each prove outbound DNS/HTTPS, Gateway WebSocket, authenticated Gateway ready, UDP discovery send/receive, Discord IP discovery, DAVE negotiation, silent stability, controlled reconnect and DAVE renegotiation, native compatibility, no inbound UDP listener dependency, and clean SIGTERM. The host must then prove lifecycle restart. Building an image is not acceptance.

## Target boundary

Voice Rooms is not installed in Socialize. No project process has authorized, joined, messaged, modified, or measured a Socialize room.

Staff approval, an exact window and target, operator and incident/removal contacts, and a supported persistent-room or timeout-exemption mechanism are required first. If approved passive observation later proves ordinary authorized-member presence insufficient and staff supplies no supported mechanism, record exactly:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
