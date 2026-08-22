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

| Gate                      | Result               | Evidence                                                                                     |
| ------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| Frozen dependency install | `UNIT TESTED`        | `pnpm install --frozen-lockfile` passed with pnpm 11.19.0                                    |
| Clean-build verification  | `UNIT TESTED`        | `pnpm clean && pnpm verify` passed after deleting output and TypeScript build metadata       |
| Formatting and lint       | `UNIT TESTED`        | Prettier check and typed ESLint passed from a clean build state                              |
| Strict TypeScript build   | `UNIT TESTED`        | Strict typecheck and all eight workspace builds passed on Node 24.19.0                       |
| Package test suite        | `UNIT TESTED`        | 62 tests passed across 12 files                                                              |
| Workers integration suite | `INTEGRATION TESTED` | 9 migration-backed Worker, Durable Object, restart, alarm, replay, and D1 tests passed       |
| Copy triage               | `UNIT TESTED`        | Project scanner passed; Anti-AI scanner reported zero candidates                             |
| Secret scan               | `UNIT TESTED`        | Scan passed across 110 tracked and untracked candidate files                                 |
| Dependency audit          | `UNIT TESTED`        | `pnpm audit --audit-level high` reported no known vulnerabilities                            |
| Reusable Discord skill    | `UNIT TESTED`        | Canonical and installed copies validate and compare byte-for-byte                            |
| Worker deploy bundles     | `UNIT TESTED`        | Control dry-run passed; host and probe Worker bundles passed with Container rollout disabled |
| GitHub Actions            | `INTEGRATION TESTED` | Push run `32549335606` and PR run `32549337618` passed                                       |
| Docker image builds       | `INTEGRATION TESTED` | Both images built in both green CI runs; construction remains unavailable locally            |
| Docker/voice runtime      | `UNVERIFIED`         | No image was started on Cloudflare and no live voice transport was exercised                 |
| Computer-assisted setup   | `BLOCKED`            | Helper failed before window discovery with missing kernel assets, OS error 3                 |
| Discord application setup | `UNVERIFIED`         | Applications, credentials, permission confirmations, and private guild remain manual         |
| Cloudflare control deploy | `UNVERIFIED`         | No live Worker URL, D1 database, or Durable Object deployment                                |
| Cloudflare voice probe    | `BLOCKED`            | Selected account denied Container access because Workers Paid is not enabled                 |
| Test-guild commands       | `UNVERIFIED`         | No live Discord applications, credentials, or guild                                          |
| Socialize                 | `BLOCKED`            | Staff approval, approved window, approved IDs, and exact target ID were not supplied         |

## Required test-guild matrix

- Every `/vc` action, wrong guild/channel/user/role, and elevated denial.
- Every `/voice`, `!voice`, and `!v` action with valid and invalid ownership.
- Prefix-disabled behavior without Message Content.
- `/voice-admin` setup idempotency, status, enable, disable, and exact target authorization.
- One room per owner; owner absent/present claim; 15-second deletion with bots only; cancellation on human rejoin.
- Staff overwrite preservation on reset.
- Relay length, NFC, control/bidi, prefix, mention suppression, operator limit, deployment limit, and Discord 429.
- Duplicate, expired, wrong-key, forged, and replayed command envelopes.
- Durable Object eviction and reconnect; D1 failure/outbox recovery; 24-hour receipt behavior.
- Gateway and voice interruption; moderator move/disconnect; permission loss; target deletion; no reconnect after intentional removal.
- Process restart and SIGTERM.

## Live probe fields

Both Container runs must report true for DNS, HTTPS, Gateway WebSocket hello, bot Gateway ready, Discord UDP IP discovery, DAVE, stable silent connection, reconnect, native stack, and no inbound UDP listener requirement. Run IDs must differ.
