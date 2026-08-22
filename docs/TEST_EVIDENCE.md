# Test evidence

Evidence captured here must be sanitized. Raw command output stays under ignored `.runtime/`.

## Labels

- `UNIT TESTED`: deterministic local test.
- `INTEGRATION TESTED`: multiple real project components under a local or Workers test runtime.
- `LIVE TEST-GUILD VERIFIED`: observed through the two official applications in `VC Control Lab`.
- `TARGET-GUILD VERIFIED`: observed in the staff-approved target guild and window.
- `UNVERIFIED`: not observed at that level.
- `BLOCKED`: an external prerequisite or failed acceptance gate prevents completion.
- `PREREQUISITE MET`: a required account or configuration condition was directly observed; it is not runtime proof.

## Current checkpoint

| Gate                      | Result               | Evidence                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen dependency install | `UNIT TESTED`        | `pnpm install --frozen-lockfile` passed with pnpm 11.19.0                                                                                                                                                                                                      |
| Clean-build verification  | `UNIT TESTED`        | `pnpm clean && pnpm verify` passed after deleting output and TypeScript build metadata                                                                                                                                                                         |
| Formatting and lint       | `UNIT TESTED`        | Prettier check and typed ESLint passed from a clean build state                                                                                                                                                                                                |
| Strict TypeScript build   | `UNIT TESTED`        | Strict typecheck and all eight workspace builds passed on Node 24.19.0                                                                                                                                                                                         |
| Package test suite        | `UNIT TESTED`        | 91 tests passed across 15 files, including managed-room race/ACL, stale voice-attempt, and mutually exclusive host/probe regressions                                                                                                                           |
| Workers integration suite | `INTEGRATION TESTED` | 18 migration-backed Worker, Durable Object, D1, interaction replay, execution ledger, heartbeat, and fail-closed outbox tests passed                                                                                                                           |
| Copy triage               | `UNIT TESTED`        | Project scanner passed across 22 files; Anti-AI scanner reported zero candidates                                                                                                                                                                               |
| Secret scan               | `UNIT TESTED`        | Scan passed across 116 tracked and untracked candidate files and checks both Git and Docker exclusion of the fallback environment path                                                                                                                         |
| Dependency audit          | `UNIT TESTED`        | `pnpm audit --audit-level high` reported no known vulnerabilities                                                                                                                                                                                              |
| Standard security review  | `INTEGRATION TESTED` | A source-only baseline scan reported 14 findings; all 14 have current source remediations and focused regressions, followed by the complete clean verification gate                                                                                            |
| Reusable Discord skill    | `UNIT TESTED`        | Canonical and installed copies validate and compare byte-for-byte                                                                                                                                                                                              |
| Worker deploy bundles     | `UNIT TESTED`        | Current control and combined voice-host/probe bundles pass Wrangler dry-runs; Container rollout is disabled for the host dry-run because Docker is unavailable locally                                                                                         |
| GitHub Actions            | `INTEGRATION TESTED` | Published `main` commit `61b71bd` passed run `32561761269`: source verification, secret scan, dependency audit, both image builds, and the control Worker dry-run                                                                                              |
| Docker image builds       | `INTEGRATION TESTED` | Both the voice-agent and Cloudflare probe images built for published `main` commit `61b71bd`; construction remains unavailable locally                                                                                                                         |
| Docker/voice runtime      | `UNVERIFIED`         | No image was started on Cloudflare and no live voice transport was exercised                                                                                                                                                                                   |
| Computer-assisted setup   | `PARTIAL`            | Computer control created `VC Control Lab`, `voice-control`, `voice-probe`, and the `VC Control` application without opening a credential. `Voice Rooms` creation is waiting on a second user-solved hCaptcha                                                   |
| UI inspection incident    | `OBSERVED`           | Selecting Discord's `Open Chat` control unexpectedly joined the operator's user account to `voice-probe`; it was immediately disconnected. Discord displayed input error 3002, no message was sent, and this event is excluded from bot or voice-host evidence |
| Discord application setup | `BLOCKED`            | `VC Control` is prefilled and its developer terms box is selected; Create was not pressed. Persistent application creation awaits action-time confirmation, and no credential was displayed or copied                                                          |
| Cloudflare control deploy | `UNVERIFIED`         | No live Worker URL, D1 database, or Durable Object deployment                                                                                                                                                                                                  |
| Cloudflare Workers Paid   | `PREREQUISITE MET`   | Authenticated account UI shows Workers Paid as the current plan and Containers included; no account or billing identifiers were committed                                                                                                                      |
| Cloudflare voice probe    | `UNVERIFIED`         | Billing no longer blocks deployment; no probe Container run, UDP/DAVE report, clean stop, or lifecycle restart has been observed                                                                                                                               |
| Test-guild commands       | `UNVERIFIED`         | The private guild and requested channels exist; no application, credential, registered command, Gateway session, or voice session exists                                                                                                                       |
| Socialize                 | `BLOCKED`            | Staff approval, approved window, approved IDs, operator/removal contacts, and exact target ID were not supplied                                                                                                                                                |

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
