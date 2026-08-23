# Final evidence report

## 1. Repository state

- Repository: <https://github.com/slaveofsolace/discord-voice-control-plane>
- Root: `C:\AI Projects\discord-voice-control-plane`
- Branch: `main`
- Recovery evidence: external patch, untracked-file hash manifest, and repository-state record under `C:\AI Projects\.codex-recovery\discord-voice-control-plane-20260822-182407`
- Reviewable implementation checkpoints: `db74bed` for the inherited Discord RPC adapter and `bfe8824` for private relay intake, authenticated ingress, encrypted queue, and dashboard

Publication SHA, final dirty state, and exact-SHA CI result belong in the delivery closeout because a commit cannot truthfully contain its own final SHA.

## 2. Product model

`Voice Rooms` is private-control-only for this deployment. It accepts messages from one locked channel and exact operator allowlists. It is not installed in Socialize.

The OAuth-authorized Discord desktop account supplies target voice presence through documented local RPC. The private bot queues requests but cannot make the normal account send. The owner performs the final paste and send.

`OWNER_CONFIRMED_SENT` is a human receipt. It does not prove Discord delivery and has no `target_message_id`.

## 3. Architecture

The private bot signs relay ingress with a separate HMAC. The control Worker revalidates timestamp, nonce, tenant, deployment, application, guild, channel, source message, actor, roles, and content grammar. Deterministic source-message idempotency prevents duplicates after Gateway reconnects.

The Worker accepts content only while the authorized local RPC agent is connected. Cloudflare stores hash, length, actor/source IDs, status, timestamps, and result code, never the body. The existing 30-second signed agent envelope transports content to the local agent.

The local agent stores accepted content in a per-profile AES-256-GCM queue. Its secured loopback dashboard controls preparation and terminal status. Preparation rechecks OAuth identity, RPC, exact voice/text targets, TTL, and state before selecting the exact text channel and invoking fixed-path `clip.exe`.

## 4. Implemented controls

- Exact private relay guild, channel, application, operator, role, and elevated allowlists.
- Bot, webhook, edit, attachment, embed, thread, empty-message, and wrong-context denial.
- NFC-normalized ordinary text and exact `!voice`/`!v` grammar with elevated risk classification.
- Separate ingress secret, freshness, nonce replay protection, constant-time verification, body cap, and durable idempotency.
- Offline rejection without cloud body retention.
- Queue cap 50, TTL 30 minutes, FIFO display, authenticated encryption, atomic backup recovery, restart persistence, terminal content purge, and target/profile invalidation.
- Loopback-only dashboard with exact Host/Origin, SameSite session, CSRF, CSP, no CORS/remote assets, and bounded bodies.
- Profile-bound dashboard secret, separate named profiles/keys/queues, and one active profile per deployment.
- Status and cancellation controls that reveal no content; only originator/elevated cancellation.
- Source-negative tests for forbidden user-token, Gateway, send, keystroke, audio, scheduler, and keepalive paths.

## 5. Verification evidence

Local verification currently records 163 package tests across 30 files and 23 migration-backed Workers tests. Coverage includes authorization, grammar, risk, HMAC/timestamp/replay/tamper/idempotency, offline privacy, D1 redaction, queue encryption/recovery/TTL/cap/FIFO/cancellation, dashboard security, prepare-time revalidation, fixed `clip.exe` behavior, lifecycle status, profile isolation, wrong-user blocking, and forbidden-source checks.

Formatting, typed lint, strict typecheck, all workspace builds, 163 package tests, 23 Workers tests, the 156-file secret scan, dependency audit, 22-file copy triage, Anti-AI scan, Human Cortex schema validation, and diff check passed before the documentation checkpoint. The immutable-range security result and exact-SHA CI URL are reported outside this commit.

These tests do not prove live Discord, OAuth, voice, Cloudflare, Container, or Socialize behavior.

## 6. Private resource state

The private `VC Control Lab` server, `voice-control`, `voice-probe`, `VC Control`, and `Voice Rooms` were observed in an earlier authenticated setup checkpoint. `VC Control` was installed. An earlier seven-permission Voice Rooms consent was staged but never granted; it is obsolete for relay-only mode and must not be approved. Generate a new four-permission private relay consent instead.

The final Voice Rooms consent, Message Content toggle, protected credentials, command registration, live relay, and permission-denial matrix remain `UNVERIFIED`. No credential value appears in source or this report.

## 7. RPC and local queue state

The RPC transport, OAuth storage/refresh, exact profile/user/guild/target checks, profile lock, encrypted queue, dashboard, and preparation path are source-tested.

No verified `main` profile proof exists in committed evidence. The earlier owner message “auth granted” did not establish a profile-bound authenticated user and exact target. The protected profile directory was not read for this report.

The queue URL, dashboard session, RPC join/leave, restart recovery against a real profile, clipboard preparation, manual paste/send, owner confirmation, and independent Discord delivery remain `UNVERIFIED`. User-logon startup is intentionally not installed before private-lab acceptance.

## 8. Cloudflare and target state

Workers Paid was observed as active. No current control Worker, D1 database, Durable Object, private voice host, Container probe, live URL, image revision, or rollback exercise is claimed.

Socialize is untouched and `BLOCKED`. No project bot was installed, and no target was authorized, joined, messaged, modified, or measured. Staff must supply an approved window, exact voice/text targets, named account/operators, incident/removal contacts, and a supported persistent-room or timeout-exemption mechanism.

There is no retention or anti-AFK claim. If approved passive observation later proves ordinary authorized-member presence insufficient and staff provides no supported configuration, record `TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`.

## 9. Rollback and recovery

The runbook covers relay disablement, emergency disconnect, OAuth revocation, named-profile isolation, queue integrity recovery, Worker version rollback, Container revision rollback, D1 compensating migrations/PITR, bot and application removal, ingress/agent/dashboard key rotation, audit purge, and local shutdown.

The external recovery patch and hash manifest preserve the inherited dirty checkpoint independently of Git. Startup remains an interactive-user concern after private-lab acceptance because Discord desktop RPC is required.

## 10. Next live action

While Discord desktop is signed into the intended account, complete the protected OAuth flow for profile `main` with `pnpm user-rpc:authorize`. Do not paste credentials into chat. A valid next checkpoint is a profile-bound RPC authentication showing the expected user and exact private-lab target; only then run the private-lab queue and manual-send matrix.
