# Final evidence report

## 1. Repository State

- Public MIT repository: <https://github.com/slaveofsolace/discord-voice-control-plane>
- Authoritative branch: `main`
- Pull request #1 retains the initial review history. Its temporary source branch was fast-forwarded into `main` and removed after verification.
- The final handoff requires a clean working tree, `main` tracking `origin/main`, and a successful main-branch CI run.
- Source, migrations, ID-free Wrangler configuration, Dockerfiles, local examples, deployment and rollback scripts, CI, security checks, operator documentation, and the reusable Discord operations skill are included.

Repository publication is complete. Publication does not upgrade any live Discord, Cloudflare, or target-guild claim.

## 2. Research Conclusions

- Discord application commands can be installed without a bot user, so `VC Control` remains an interaction-only app with no bot token or Gateway session.
- `Voice Rooms` must be an official bot because voice presence, member prefix commands, and managed-room state require Gateway events and Discord REST operations.
- Message Content is required only when a deployment explicitly enables `!voice` and `!v`; the public template leaves both related flags off.
- A successful Container image build or HTTP health check does not establish Discord voice compatibility. DNS, HTTPS, Gateway, UDP discovery, DAVE, silent stability, recovery, native compatibility, clean termination, and lifecycle restart require a live probe.
- Normal official-bot presence is not assumed to preserve a third-party temporary room. That behavior must be measured during a staff-approved window without synthetic activity.

## 3. Architecture Decision

Cloudflare hosts the signed interaction endpoint, D1 configuration and audit records, the SQLite-backed `AgentSession` Durable Object, and the private voice-host controller. The voice bot runs as one isolated agent process per deployment.

Cloudflare Container hosting is accepted only if the dedicated probe passes every fail-closed field twice with different run IDs and clean SIGTERM evidence. If UDP, DAVE, native compatibility, restart, or lifecycle behavior fails, the Cloudflare control plane remains in place and the same voice-agent image moves to the Docker Compose/systemd adapter on an authorized conventional host. See `ADR-001-voice-agent-hosting.md`.

## 4. Implemented Changes

- `/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit` with normal and elevated operator allowlists.
- `/voice` plus opt-in `!voice` and `!v` implementations for all twelve member commands.
- `/voice-admin setup|status|enable|disable|authorize-target` with idempotent guild setup and exact target authorization.
- One managed room per human owner, 15-second zero-human cleanup even when bots remain, restart reconciliation, claim rules, and preservation of unrelated permission overwrites.
- Presence-only behavior for external temporary rooms; managed-room commands and ACL ownership do not cross that boundary.
- Versioned HMAC envelopes, signed WebSocket challenge, replay cache, idempotency receipts, heartbeats, circuit breaker, and ordered recovery outboxes.
- A DAVE-gated voice state machine with bounded retry, controlled rejoin, moderator-removal blocking, self-mute/self-deaf, and no audio receive or send path.
- A private Container host, fail-closed Cloudflare voice probe, and conventional-host fallback.

## 5. Security Controls

- Discord Ed25519 verification runs against the raw request before JSON parsing or command dispatch.
- Application, tenant, deployment, guild, channel, user, role, elevated-user, elevated-role, exact-target, and managed-guild checks fail closed.
- Agent envelopes expire after 30 seconds, nonces remain replay-protected for five minutes, and receipts remain idempotent for 24 hours across current/previous key rotation.
- Discord relay uses NFC normalization, a 1,000-character limit, C0/C1 and bidi rejection, command-prefix rejection, empty mention parsing, two rate-limit scopes, and an enforced deterministic message nonce. Audits retain metadata rather than relay text.
- The presence-only profile requests only View Channel, Connect, Send Messages, and Read Message History. Managed rooms additionally request Manage Channels, Manage Roles, and Move Members. Neither profile requests Administrator, Manage Guild, Kick Members, Ban Members, or Manage Webhooks.
- The control Worker cannot read the Voice Rooms bot token. Logs and committed evidence exclude secrets, relay content, and unnecessary account identifiers.

## 6. Verification Evidence

- `UNIT TESTED`: clean `pnpm verify` passed formatting, typed lint, strict typecheck, all eight workspace builds, and 77 package tests across 14 files.
- `INTEGRATION TESTED`: 13 migration-backed Workers, Durable Object, D1, alarm, outbox, restart, authorization, and configuration tests passed.
- `UNIT TESTED`: copy triage passed across 21 files; secret scanning passed across 112 candidate files; the high-severity dependency audit reported no known vulnerabilities.
- `UNIT TESTED`: all three Worker bundles passed Wrangler dry-runs. The two Container-backed Workers were bundled locally with Container rollout disabled because Docker is unavailable on this machine.
- `INTEGRATION TESTED`: GitHub Actions runs `32551597849` and `32551599391` passed the complete verification, both Docker image builds, scans, dependency audit, and control Worker dry-run at commit `180abd0594980d0dbcaeddfa5cab53914bb54016`.
- `UNIT TESTED`: the canonical and installed `authorized-discord-bot-ops` skill copies validate and match byte-for-byte.
- `UNVERIFIED`: no local Docker runtime, live Discord application, Discord voice transport, Cloudflare Container, or target-guild behavior is counted by these results.

## 7. Deployment State

The control Worker, D1 database, Durable Object, private voice host, and probe are not deployed. No live URL, production database ID, Container revision, probe report, or rollback exercise exists.

Cloudflare voice deployment is `BLOCKED`. The selected account reported that Container access requires Workers Paid. Billing was not automated. The user must enable that plan manually before deployment resumes.

The private `VC Control Lab` guild and its two applications are also `UNVERIFIED`. The authorized Computer helper was retried once and failed before window discovery with missing kernel assets, OS error 3. Login, MFA, CAPTCHA, credential display, token copying, security prompts, and permission confirmation remain manual in every case.

## 8. Target-Guild State

Socialize is `BLOCKED`. Staff has not supplied an approval reference, approved window, approved application and bot IDs, target guild ID, exact temporary voice-channel ID, operator list, or removal contact. No target was authorized, joined, relayed to, modified, or measured.

Presence-only behavior and deletion timing are `UNVERIFIED`. The terminal retention phrase is used only after a live approved observation proves official-bot presence insufficient and staff confirms that no supported persistent or exempt configuration exists.

## 9. Rollback

The runbook covers Worker version rollback, Container image revision rollback, command disablement, emergency disconnect, application removal, bot-token rotation, current/previous agent-key rotation, audit purge, and compensating D1 migrations. D1 point-in-time recovery is reserved for an explicitly authorized incident because it can discard later records.

The conventional-host fallback uses the same voice-agent image and authenticated control path. It does not weaken target authorization, voice privacy, relay filtering, or state-machine boundaries.

## 10. Remaining Work

1. The user manually enables Workers Paid on the selected Cloudflare account without sharing billing information.
2. An authorized operator creates `VC Control Lab`, `VC Control`, and `Voice Rooms`, handles protected credentials and permission confirmations, and completes the live private-guild command matrix.
3. Deploy the control plane, run two fail-closed Container probe cycles, capture clean SIGTERM and distinct-run evidence, then choose Cloudflare or the documented conventional host from the result.
4. Socialize staff completes `SOCIALIZE_INTAKE.md`. During the approved window, test only official-bot presence controls and one ordinary relay, then observe deletion without synthetic activity.
5. Exercise rollback and credential rotation in the private environment. Until those actions occur, the corresponding labels remain `UNVERIFIED` or `BLOCKED`.
