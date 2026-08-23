# Runbook

## Normal checks

1. Confirm the active profile name, expected OAuth user, exact guild, exact voice target, and exact text target.
2. Confirm the user RPC agent reports a server-received heartbeat younger than 45 seconds and `authorized_local_rpc`.
3. Open only the printed `http://127.0.0.1:<port>/` queue URL. `/healthz` should return minimal process health.
4. Confirm the private Voice Rooms instance is in relay-only mode and its exact application, guild, channel, operator, and elevated allowlists match.
5. Confirm Cloudflare audit and relay records contain hashes and routing metadata, never content.
6. Do not proceed after an unexplained moderator move, disconnect, permission loss, or target change.

## Relay lifecycle

1. An operator sends ordinary text or an exact `!voice` or `!v` command in the locked private relay channel.
2. Voice Rooms replies with a request ID and status/cancel controls.
3. The control Worker accepts only if the local RPC agent is connected. Offline requests return `LOCAL_AGENT_OFFLINE` without retaining the body.
4. The local queue stores the request as `PENDING_USER_APPROVAL`.
5. The owner reviews sender, target, age, content, parsed command, risk, and state.
6. **Prepare in Discord** rechecks OAuth identity, profile, exact targets, selected voice, TTL, and state; then it selects the exact text channel and copies the draft with `C:\Windows\System32\clip.exe`.
7. The owner manually pastes and sends. No program presses paste or Enter.
8. **Mark sent** records `OWNER_CONFIRMED_SENT`; it does not prove a Discord message or ID. **Not sent**, **Reject**, **Expire**, and authorized cancellation produce their corresponding terminal state and purge content.

A request expires after 30 minutes. The queue admits at most 50 nonterminal items and displays them FIFO. Profile or target-authorization changes invalidate every nonterminal item.

## Profile operation

Start with `main`:

```bat
set USER_RPC_PROFILE=main
pnpm user-rpc:authorize
pnpm build
pnpm with:user-rpc-profile -- pnpm --filter @discord-vc-control/user-rpc-agent start
```

Authorization and startup must occur while the official Discord desktop client is signed into the intended account. Stop for manual OAuth approval. Do not expose profile files or secrets.

To add a later account, create a new profile such as `presence` while Discord desktop is manually signed into that account. Never rename, copy over, or overwrite `main`. Only one profile may hold a deployment lock at a time.

Do not install user-logon startup until private-lab acceptance passes. When it does, the startup mechanism must launch an interactive-user process after Discord desktop; it must not become a headless service.

## Fail-closed conditions

Stop or remain blocked when:

- Discord desktop or RPC is absent.
- OAuth refresh or identity verification fails.
- The signed-in account, guild, voice target, or text target differs.
- The account is already in another voice channel.
- Discord or moderation moves or disconnects the account.
- The local queue cannot authenticate or recover its ciphertext.
- The target or profile authorization changes.
- The Worker reports stale heartbeats, replay, bad HMAC, or reconciliation failure.

Correct and reauthorize the cause before using an elevated reconnect. Never reconnect to override an unexplained staff action.

## Emergency stop

1. Disable `CONTROL_RELAY_ENABLED` and redeploy the private Voice Rooms process.
2. Run `/vc leave` if the authenticated control path is healthy.
3. Stop the local RPC agent and close its dashboard.
4. Revoke the affected OAuth grant if identity or profile integrity is in doubt.
5. Rotate ingress, agent, dashboard, bot, or Cloudflare secrets as applicable.
6. Do not reconnect until exact authorization and staff intent are rechecked.

## State recovery

Agent commands are serialized. A command enters the Durable Object executing ledger before the agent performs a side effect; do not delete an executing record to force retry without determining whether preparation occurred.

Transient D1 failures enter alarm-driven audit or state outboxes. Audit capacity fails new commands closed. A permanent reconciliation conflict blocks bootstrap until a newer valid snapshot reconciles that key.

The encrypted local queue recovers from its authenticated backup after an interrupted atomic write. Authentication failure is an incident; do not discard the queue merely to make startup pass. Terminal content is not recoverable by design.

## Rollback

Worker and Container:

1. List versions and choose the known revision.
2. Set `ROLLBACK_APPROVED=discord-voice-control-plane` and `ROLLBACK_VERSION_ID`.
3. Run `pnpm rollback -- control` or `pnpm rollback -- voice-host`.
4. Recheck bindings, named Container revision, heartbeat, relay-only mode, and exact target before resuming.

D1:

- Prefer a forward compensating migration.
- Record the migration list and PITR bookmark before schema changes.
- Use PITR only with explicit incident authorization because later records can be lost.
- Never delete tables from an unverified database.

Credentials:

- Rotate current and previous agent keys through a bounded overlap and remove the previous key after every live client reports the new `kid`.
- Rotate the separate relay-ingress HMAC independently.
- Revoke and reauthorize a named OAuth profile after compromise. Do not move another profile's files into its place.
- Rotate the local dashboard secret and queue encryption key only through the profile recovery procedure; existing encrypted content cannot be silently retargeted.

Audit purge:

- Disable ingress first.
- Export only authorized, redacted incident evidence.
- Delete selected deployment rows through a reviewed D1 statement.
- Record authorization and row count, never row content.

## Socialize boundary

Voice Rooms is not installed in Socialize. No target has been authorized, joined, messaged, modified, or observed. Staff approval, an exact window and targets, contacts, and a supported persistent-room or timeout-exemption mechanism are required before any target action.

Observe retention without synthetic activity. If approved passive observation shows that normal authorized-member presence is insufficient and staff supplies no supported persistent or exempt configuration, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
