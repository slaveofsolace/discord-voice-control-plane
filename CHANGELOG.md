# Changelog

## Unreleased

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

No Discord or Cloudflare live verification is claimed by this entry.
