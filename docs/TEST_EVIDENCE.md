# Test evidence

Evidence captured here must be sanitized. Raw command output stays under ignored `.runtime/`.

## Labels

- `UNIT TESTED`: deterministic local test.
- `INTEGRATION TESTED`: multiple real project components under a local or Workers test runtime.
- `LIVE TEST-GUILD VERIFIED`: observed through the two official applications in `VC Control Lab`.
- `TARGET-GUILD VERIFIED`: observed in the staff-approved target guild and window.
- `UNVERIFIED`: not observed at that level.
- `BLOCKED`: an external prerequisite or failed acceptance gate prevents completion.

## Current checkpoint

| Gate                      | Result               | Evidence                                                                                                        |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Frozen dependency install | `UNIT TESTED`        | `pnpm install --frozen-lockfile` passed with pnpm 11.19.0                                                       |
| Clean-build verification  | `UNIT TESTED`        | `pnpm clean && pnpm verify` passed after deleting output and TypeScript build metadata                          |
| Formatting and lint       | `UNIT TESTED`        | Prettier check and typed ESLint passed from a clean build state                                                 |
| Strict TypeScript build   | `UNIT TESTED`        | Strict typecheck and all eight workspace builds passed on Node 24.19.0                                          |
| Package test suite        | `UNIT TESTED`        | 77 tests passed across 14 files                                                                                 |
| Workers integration suite | `INTEGRATION TESTED` | 13 migration-backed Worker, Durable Object, D1, configuration, restart, alarm, replay, and outbox tests passed  |
| Copy triage               | `UNIT TESTED`        | Project scanner passed across 22 files; Anti-AI scanner reported zero candidates                                |
| Secret scan               | `UNIT TESTED`        | Scan passed across 113 tracked and untracked candidate files                                                    |
| Dependency audit          | `UNIT TESTED`        | `pnpm audit --audit-level high` reported no known vulnerabilities                                               |
| Reusable Discord skill    | `UNIT TESTED`        | Canonical and installed copies validate and compare byte-for-byte                                               |
| Worker deploy bundles     | `UNIT TESTED`        | Control dry-run passed; host and probe bundles passed with Container rollout disabled locally                   |
| GitHub Actions            | `INTEGRATION TESTED` | Main run `32552515725` passed at commit `0f52c53`; earlier implementation push/PR runs also passed              |
| Docker image builds       | `INTEGRATION TESTED` | Both images built in both green CI runs; construction remains unavailable locally                               |
| Docker/voice runtime      | `UNVERIFIED`         | No image was started on Cloudflare and no live voice transport was exercised                                    |
| Computer-assisted setup   | `BLOCKED`            | One helper recheck failed before window discovery with missing kernel assets, OS error 3                        |
| Discord application setup | `BLOCKED`            | No protected Discord variables or ignored live secret files exist; applications and permissions remain manual   |
| Cloudflare control deploy | `UNVERIFIED`         | No live Worker URL, D1 database, or Durable Object deployment                                                   |
| Cloudflare voice probe    | `BLOCKED`            | Prior account check required Workers Paid; current recheck also requires owner selection between two accounts   |
| Test-guild commands       | `UNVERIFIED`         | No live Discord applications, credentials, or guild                                                             |
| Socialize                 | `BLOCKED`            | Staff approval, approved window, approved IDs, operator/removal contacts, and exact target ID were not supplied |

## Required test-guild matrix

- Every `/vc` action, wrong application/tenant/deployment/guild/channel/user/role, elevated denial, stale heartbeat, and diagnostics result.
- Every `/voice`, `!voice`, and `!v` action with valid and invalid ownership.
- Prefix-disabled behavior without Message Content.
- `/voice-admin` setup idempotency, status, enable, disable, managed-guild allowlist, and exact target authorization.
- One room per owner; owner absent/present claim; 15-second deletion with bots only; restart reconciliation; cancellation on human rejoin.
- Staff overwrite preservation on reset and ACL subject caps before Discord edits.
- Relay length, NFC, control/bidi, prefix, mention suppression, deterministic enforced Discord nonce, operator limit, deployment limit, redelivery, and Discord 429.
- Duplicate, expired, wrong-key, wrong-tenant, wrong-deployment, forged, and replayed command envelopes.
- Durable Object eviction and reconnect; D1 state/audit outbox recovery; ordered replay; 24-hour receipt behavior.
- Gateway and voice interruption; controlled rejoin; DAVE pending/timeout; moderator move/disconnect; permission loss; target deletion; no reconnect after intentional removal.
- Process restart, Gateway reauthentication, and clean SIGTERM.

## Live probe fields

Both Container reports must pass the fail-closed fields for DNS, HTTPS, raw Gateway WebSocket hello, bot Gateway ready, fresh Gateway reauthentication, UDP socket creation, discovery send, discovery response, Discord IP discovery, voice ready, DAVE negotiation, DAVE renegotiation after controlled voice rejoin, pre/post-rejoin stability, native DAVE stack, no inbound UDP listener requirement or listener, no audio traffic, and SIGTERM readiness. The two run IDs must differ, both `onStop` records must show a requested SIGTERM with clean exit, and the controller must reach `LIFECYCLE_RESTART_VERIFIED`.
