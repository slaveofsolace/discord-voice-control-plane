# Runbook

## Normal checks

1. `/vc status`: Agent connected, heartbeat younger than 45 seconds, expected target, closed circuit.
2. `/vc diagnostics`: Gateway, voice, UDP, DAVE, retry count, and redacted last error.
3. `/voice-admin status`: feature profile, category, lobby, command channel, room count, and prefix flag.
4. Cloudflare logs: structured event names only; no tokens or relay content.

## Voice states

- `DISABLED`: no desired connection.
- `STARTING`: agent process initialization.
- `CONNECTING`: authorized voice connection in progress.
- `CONNECTED`: Discord voice connection is ready.
- `DEGRADED`: health is incomplete but the circuit is not open.
- `BACKING_OFF`: bounded transient retry delay.
- `PAUSED`: operator pause; no automatic reconnect.
- `BLOCKED`: explicit operator action is required.
- `SHUTTING_DOWN`: SIGTERM or SIGINT cleanup.

Moderator disconnect or move, permission loss, deleted target, invalid authorization, repeated DAVE/auth failure, close code 4014, or exhausted retries must not loop. Correct the cause, re-authorize if needed, then use the elevated `/vc reconnect`.

## Emergency disconnect

1. Run `/vc leave` if the control path is healthy.
2. Set `HOST_ENABLED=false` and redeploy/reconcile the host, or stop the fallback service.
3. Remove Voice Rooms from the guild if the connection cannot be controlled.
4. Do not reconnect until the exact target and staff authorization are rechecked.

## Command disablement

- Disable VC Control in Discord's Integrations settings or remove its guild command.
- Run `/voice-admin disable` to stop new managed rooms.
- Set prefix flags false and redeploy to remove Message Content from the Gateway identify payload.
- Remove the applications when decommissioning.

## Rollback

Worker and Container image:

1. List Worker versions and choose the known revision.
2. Set `ROLLBACK_APPROVED=discord-voice-control-plane` and `ROLLBACK_VERSION_ID`.
3. Run `pnpm rollback -- control` or the selected service argument.
4. Confirm that the restored Worker references an available Container image revision.

D1:

- Prefer a forward compensating migration.
- Before a schema change, record the migration list and D1 point-in-time recovery bookmark.
- Use D1 PITR only with explicit incident authorization; it can discard later records.
- Never reverse a migration by deleting tables from an unverified database.

Credentials:

- Rotate a Discord bot token in the portal, replace the host secret, and restart the agent.
- Rotate agent HMAC keys by deploying the new current key while retaining the old key and `kid` for a short overlap. Remove the previous key after every live agent reports the new `kid`.
- Rotate the interaction-only app client secret only in the operator registration environment; the Worker does not use it.

Audit purge:

- Disable commands first.
- Export only authorized sanitized incident evidence.
- Delete selected audit rows or all deployment audit rows through an explicitly reviewed D1 statement.
- Record the count and authorization; never log row contents.

## Discord 429

Respect Discord's retry response and stop manual repetition. The control envelope expires after 30 seconds; issue a new authorized command after the rate-limit window instead of changing its timestamps or nonce.

## Socialize retention result

Observe without synthetic activity. If the third-party room deletes despite normal bot presence and staff supplies no supported persistence mode, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
