# Runbook

## Normal checks

1. `/vc status`: expected agent type, server-received heartbeat younger than 45 seconds, expected tenant/deployment and target, closed circuit.
2. `/vc diagnostics`: bot mode reports redacted Gateway/voice/UDP/DAVE details; local RPC mode reports desktop IPC and selected-channel state while marking Gateway, UDP, and DAVE unowned or unobservable.
3. `/voice-admin status`: feature profile, managed-guild allowlist result, category, lobby, command channel, room count, and prefix flag.
4. Cloudflare logs: structured event names only; no tokens or relay content.
5. D1/AgentSession: no growing audit or state outbox, expected 24-hour receipts, and successful daily audit-retention event.

## Voice states

- `DISABLED`: no desired connection.
- `STARTING`: agent process initialization.
- `CONNECTING`: authorized voice connection in progress.
- `CONNECTED`: Discord voice is ready and DAVE has been observed.
- `DEGRADED`: health is incomplete, including DAVE still pending, but the circuit is not open.
- `BACKING_OFF`: bounded transient retry delay.
- `PAUSED`: operator pause; no automatic reconnect.
- `BLOCKED`: explicit operator action is required.
- `SHUTTING_DOWN`: SIGTERM or SIGINT cleanup.

Moderator disconnect or move, permission loss, deleted target, invalid authorization, local-profile mismatch, repeated DAVE/auth failure, close code 4014, or exhausted retries must not loop. Correct the cause, re-authorize if needed, then use the elevated `/vc reconnect`. Do not use reconnect to override an unexplained staff action. Local RPC never forces a user out of another voice channel.

## Emergency disconnect

1. Run `/vc leave` if the control path is healthy.
2. Set `HOST_ENABLED=false` and redeploy/reconcile the host, or stop the fallback service.
3. Remove Voice Rooms from the guild if the connection cannot be controlled.
4. For local RPC, close the local agent, revoke the OAuth grant, and delete the selected ignored profile.
5. Do not reconnect until the exact target, authorization, and staff intent are rechecked.

## Command disablement

- Disable VC Control in Discord's Integrations settings or remove its guild command.
- Run `/voice-admin disable` to stop new managed rooms.
- Set `MANAGED_ROOMS_ENABLED=false` or clear `MANAGED_GUILD_IDS` to fail closed.
- Set prefix flags false and redeploy to remove Message Content from the Gateway identify payload.
- Remove the applications when decommissioning.

## State recovery

- Agent messages are serialized. Status, config, target, and room snapshots are coalesced by object key and replayed after authenticated bootstrap.
- A command moves into the Durable Object executing ledger before the agent performs its side effect. A missing start acknowledgement or final receipt fails closed; do not delete an executing record to force a retry without reviewing whether the effect already occurred.
- Transient D1 failures enter audit or state reconciliation queues and alarms retry them. An audit queue at capacity rejects new control actions. A permanent state conflict enters `STATE_RECONCILIATION_BLOCKED` and prevents bootstrap until a newer valid snapshot for that key reconciles it. Investigate the cause before purging anything.
- Agent-supplied timestamps are diagnostic only. Liveness uses the Worker's receipt time.
- On process restart, managed-room reconciliation schedules any zero-human or bot-only room for the normal 15-second deletion grace.

## Rollback

Worker and Container image:

1. List Worker versions and choose the known revision.
2. Set `ROLLBACK_APPROVED=discord-voice-control-plane` and `ROLLBACK_VERSION_ID`.
3. Run `pnpm rollback -- control` or `pnpm rollback -- voice-host`.
4. Confirm that the restored Worker references an available Container image revision.
5. Recheck host cron, named Container state, AgentSession heartbeat, and exact target before resuming.

D1:

- Prefer a forward compensating migration.
- Before a schema change, record the migration list and D1 point-in-time recovery bookmark.
- Use D1 PITR only with explicit incident authorization; it can discard later records.
- Never reverse a migration by deleting tables from an unverified database.

Credentials:

- Rotate a Discord bot token in the portal, replace the host secret, and restart the agent.
- Rotate agent HMAC keys by deploying the new current key while retaining the old key and `kid` for a short overlap. Use `--include-previous` only for that planned overlap. Remove the previous key after every live agent reports the new `kid`.
- Rotate the interaction-only app client secret only in the operator registration environment; the Worker does not use it.
- Reauthorize a local RPC profile when changing Discord users or after OAuth revocation. Never copy a raw Discord user token. Delete the old ignored profile after its OAuth grant is revoked.

Audit purge:

- Disable commands first.
- Export only authorized sanitized incident evidence.
- Delete selected audit rows or all deployment audit rows through an explicitly reviewed D1 statement.
- Record the count and authorization; never log row contents.

## Discord 429 and relay retry

Respect Discord's retry response and stop manual repetition. The control envelope expires after 30 seconds; issue a new authorized command after the rate-limit window instead of changing its timestamps or nonce. Bot relay delivery supplies a deterministic Discord nonce with enforcement. Local RPC relay only stages a clipboard draft and must report `USER_SEND_REQUIRED`; it never has a resulting Discord message ID.

## Socialize retention result

Observe without synthetic activity. If the third-party room deletes despite normal bot presence and staff supplies no supported persistence mode, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
