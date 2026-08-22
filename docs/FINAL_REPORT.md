# Final evidence report

## 1. Scope and outcome

The repository contains the reusable Discord voice control plane, official managed-room bot, private voice-host controller, Cloudflare voice probe, conventional-host fallback, deployment tooling, tests, operator documentation, and reusable Discord operations skill described in the project plan. The source and CI gates pass. Live Discord setup, Cloudflare deployment, and Socialize observation did not occur, so this report does not claim live readiness.

Overall status: implementation and publication `PASS`; live test-guild work `UNVERIFIED`; Cloudflare voice deployment `BLOCKED`; Socialize work `BLOCKED`.

## 2. Repository and review state

- Public MIT repository: <https://github.com/slaveofsolace/discord-voice-control-plane>
- Review branch: `sol/initial-build`
- Draft PR: <https://github.com/slaveofsolace/discord-voice-control-plane/pull/1>
- Baseline: `cbffafa8d46bc88f4f1a3d09e44ab6d718cd8869`
- Foundation: `48040d6`
- Control Worker and session state: `04dfbc1`
- Voice agent, host, probe, and fallback: `6274bc7`
- Release and security automation: `2be09e0`
- Operations documentation and skill: `9804656`
- Clean-checkout CI repair: `59f0c4b5e3406cecc9715e017f83e067377a5a34`
- The working tree was clean before this evidence-only update and is a required final handoff check after it.
- PR state at this checkpoint: open and draft. It was not merged.

## 3. Architecture delivered

`control-worker` verifies the raw Discord request with Ed25519 before parsing, applies guild/channel/user/role allowlists, serves the `/vc` command surface, and coordinates a SQLite-backed `AgentSession` Durable Object. D1 stores deployment configuration, managed rooms, bot-owned ACL records, authorized targets, receipts, and redacted audit events.

`voice-host-worker` has no public route and is the only Worker designed to receive the bot token. It reconciles one named Container per deployment. `voice-agent` owns Discord Gateway, REST, and voice behavior, the exact `/voice`, `!voice`, `!v`, and `/voice-admin` surfaces, managed-room cleanup, presence-only target behavior, and safe relay. `spikes/cloudflare-voice-probe` implements the live DNS, HTTPS, Gateway, UDP discovery, DAVE, stability, recovery, lifecycle, and native-compatibility gate. Docker Compose and systemd files provide the documented conventional-host fallback.

## 4. Security and authorization evidence

- Raw-body Discord signature checks and control allowlists are unit/integration tested.
- Agent commands use versioned HMAC-SHA256 envelopes, current/previous keys, a 30-second expiry, unique nonces, a five-minute replay cache, and 24-hour idempotency receipts.
- Agent WebSocket upgrades require a signed challenge; the shared key is not sent.
- Relay applies NFC normalization, a 1,000-character cap, C0/C1 and bidi rejection, case-insensitive command-prefix rejection, mention suppression, and operator/deployment rate limits. D1 stores metadata, not relay content; authenticated pending relay text expires from Durable Object storage after 30 seconds.
- Discord permissions are split into documented presence-only and managed-room profiles. Neither requests Administrator, Manage Guild, Kick Members, Ban Members, or Manage Webhooks.
- The secret scanner passed across 110 tracked and untracked candidate files. `pnpm audit --audit-level high` reported no known vulnerabilities.
- Unresolved live risks: actual Discord grants, Container isolation, voice transport, DAVE negotiation, token rotation, and moderator-boundary behavior remain unobserved.

## 5. Local and CI verification

- `UNIT TESTED`: `pnpm install --frozen-lockfile` passed with pnpm 11.19.0 and Node 24.19.0.
- `UNIT TESTED`: a clean-build `pnpm verify` passed formatting, typed lint, strict typecheck, all eight workspace builds, 62 tests across 12 files, and copy triage across 21 files.
- `INTEGRATION TESTED`: 9 migration-backed Workers/Durable Object/D1 tests passed.
- `UNIT TESTED`: the canonical and installed `authorized-discord-bot-ops` skill copies validate and match byte-for-byte.
- `INTEGRATION TESTED`: both GitHub Actions runs passed, including secret/dependency scans, both Docker image builds, and the control Worker Wrangler dry-run: [pull-request run](https://github.com/slaveofsolace/discord-voice-control-plane/actions/runs/32549337618), [push run](https://github.com/slaveofsolace/discord-voice-control-plane/actions/runs/32549335606).
- `UNVERIFIED` locally: Docker image construction, because no Docker-compatible CLI is installed on this machine.
- `UNVERIFIED` live: image startup on Cloudflare, Discord connectivity, UDP/DAVE, and lifecycle behavior. A successful image build is not live voice evidence.

## 6. Private Discord verification

`VC Control Lab`, `VC Control`, and `Voice Rooms` were not created because protected Discord setup requires an ordinary authenticated UI session and credentials. The authorized Computer helper was retried once and failed before window discovery with missing kernel assets, OS error 3.

Therefore application command registration, every `/vc`, `/voice`, `!voice`, `!v`, and `/voice-admin` path, authorization denials, ACL preservation, bot-only cleanup, reconnect boundaries, relay delivery/suppression, process restart, and SIGTERM are all `UNVERIFIED` in a live test guild. Their deterministic and Workers-runtime components are covered by the test matrix; mocks do not upgrade this label.

## 7. Cloudflare deployment and voice proof

The control Worker, D1 database, Durable Object, voice-host Worker, and Container probe were not deployed. No control URL, live database state, Container revision, or probe run IDs exist.

Cloudflare voice deployment is `BLOCKED`. The selected account returned: `Unauthorized: You do not have access to Cloudflare Containers. Deploying containers requires the Workers Paid plan.` Billing was not automated. DNS/HTTPS, Gateway WebSocket, UDP send/receive and IP discovery, DAVE, silent stability, recovery, restart/lifecycle, native compatibility, and no-inbound-UDP behavior are `UNVERIFIED` live.

## 8. Socialize authorization and target result

Socialize work is `BLOCKED`. No staff approval reference, approved test window, approved guild/application IDs, or exact temporary voice channel ID was supplied. No target was authorized, joined, relayed to, modified, or measured.

Presence-only behavior and actual deletion timing are `UNVERIFIED`. The target-retention terminal phrase is not applicable because no live observation established whether official-bot presence is insufficient or whether staff can provide a supported persistent/exempt configuration.

## 9. Privacy, operations, and rollback

Structured logs and D1 audit rows exclude secrets and relay content. Audit retention defaults to 30 days. The runbook covers audit purge, emergency disconnect, command disablement, Discord app removal, bot-token rotation, current/previous agent-key rotation, Worker version rollback, Container image rollback, and compensating D1 migrations/PITR. Raw execution logs remain under ignored `.runtime/` and were not published.

## 10. Blockers and next atomic action

- `BLOCKED`: Cloudflare Container access requires the user to enable Workers Paid manually.
- `BLOCKED`: Socialize requires staff approval, an approved window, approved IDs, and the exact temporary voice channel ID.
- `UNVERIFIED`: private Discord applications, guild, commands, permission behavior, restarts, and SIGTERM.
- `UNVERIFIED`: live Cloudflare control/D1/Durable Object state and all voice-probe fields.
- `UNVERIFIED`: Socialize presence and deletion behavior.

Next atomic action: the user manually enables Workers Paid on the selected Cloudflare account and confirms completion without sharing billing information. The draft PR remains open and was not merged.
