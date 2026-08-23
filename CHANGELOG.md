# Changelog

## Unreleased

- Added private relay-only Voice Rooms intake with exact guild, channel, application, operator, role, and elevated-operator authorization.
- Added exact ordinary-text and `!voice`/`!v` approval grammar, including elevated-risk classification and bot, webhook, edit, attachment, embed, thread, mention, control, and unknown-command rejection.
- Added a separately keyed relay-ingress HMAC boundary with timestamp freshness, nonce replay protection, deterministic source-message idempotency, local-agent liveness checks, and redacted D1 metadata.
- Replaced immediate local draft preparation with a 50-item, 30-minute encrypted per-profile approval queue and a secured `127.0.0.1` dashboard.
- Added prepare-time OAuth identity, RPC, target, selected-voice, TTL, and state checks before fixed-path `clip.exe` preparation. The owner still performs the final paste and send; `OWNER_CONFIRMED_SENT` is not Discord delivery proof.
- Added separate profile keys, queues, and deployment locks, plus invalidation after a target or profile authorization change.
- Added negative-source checks proving the absence of raw user tokens, a user Gateway, automatic user-account sends, Discord UI keystrokes, PowerShell clipboard handling, synthetic audio, and scheduled keepalive behavior.
- Removed full relay bodies from the Durable Object execution ledger, added physical relay-metadata expiry, kept agent credentials out of relay-only bot Containers, rechecked target revisions before manual preparation, preserved startup expiry events, and consumed every signed ingress nonce.

- Added durable Discord interaction claims, a pre-effect execution ledger, expiring/revalidated agent sessions, fail-closed audit capacity, and keyed state reconciliation with dead-letter blocking.
- Added a 64 KiB interaction-body limit, complete runtime environment validation, rotation-key separation checks, and minimal Container health output.
- Serialized managed-room creation and claims, rechecked every room command against current enablement, stopped on bot-owned ACL conflicts, and cancelled stale in-flight voice joins.
- Moved the voice probe under the single token-bearing voice-host Worker and excluded fallback credentials from Git and the deny-by-default Docker build context.
- Added regressions for interaction replay, execution restart safety, outbox capacity, heartbeat expiry, managed-room races and disablement, staff ACL conflicts, and intentional leave during connection setup.

- Enforced the 30-second command lifetime in the shared envelope schema and reused the same constant in command production and test fixtures.

- Corrected `/voice-admin authorize-target` so an exact configured target approver is not accidentally blocked by the unrelated managed-room permission gate; all administration subcommands remain runtime-authorized.

- Added the interaction-only VC Control application and its signed Cloudflare Worker endpoint.
- Added the official Voice Rooms bot with slash commands and opt-in `!voice` and `!v` commands.
- Added managed-room ownership, channel-scoped ACLs, 15-second empty-room cleanup, and exact target authorization.
- Added signed control envelopes, replay protection, 24-hour receipts, redacted 30-day audit records, heartbeats, and circuit-breaking state transitions.
- Added a private Cloudflare Container host, an evidence-gated voice probe, and a Docker Compose/systemd fallback adapter.
- Added the reusable `authorized-discord-bot-ops` skill, local checks, CI, deployment scripts, and operator documentation.
- Enforced tenant and deployment isolation at the control, Durable Object, bootstrap, command, and heartbeat boundaries.
- Added ordered Durable Object state recovery, bounded agent offline recovery, daily audit retention, managed-guild allowlisting, and restart-safe empty-room cleanup.
- Made Discord voice readiness depend on DAVE observation and added controlled voice rejoin, Gateway reauthentication, two-run Container lifecycle, and clean SIGTERM evidence gates.
- Made relay delivery idempotent through Discord's enforced message nonce and tightened initial D1 provisioning, secret rotation, and deployment-variable handling.
- Added a requirement-by-requirement completion audit and a sanitized current record of the Cloudflare account-selection, private Discord, and Socialize release gates.

No live Discord, OAuth, Cloudflare, Container, Socialize, delivery, retention, or anti-AFK verification is claimed by this entry.
