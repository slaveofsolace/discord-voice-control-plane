# Architecture

## Trust boundaries

```text
Discord /vc interaction
        |
        v
Control Worker -- D1 audit/config
        |
        v signed HMAC envelope over authenticated WebSocket
AgentSession Durable Object
        ^
        |
Voice Agent in named Container -- Discord Gateway + voice UDP
        ^
        |
Private Voice Host Worker -- bot token and Container lifecycle
```

VC Control is an interaction-only Discord application. Its Worker holds the Discord public key, control allowlists, command-signing key, and internal-status secret. It never receives the Voice Rooms bot token.

Voice Host is not routed publicly. It alone reads the bot token and can pass it to the named production agent Container or the separately named probe Container. Its validated mode schema rejects starting both same-token Containers concurrently. The probe is invoked through the same private Worker boundary and has no independent secret binding. The Voice Agent opens outbound Discord Gateway, voice WebSocket, and UDP connections. It exposes only a Container-internal HTTP health endpoint containing service health and observed state, not guild or channel IDs.

AgentSession is one SQLite-backed Durable Object per deployment. It stores desired and observed state, Discord interaction claims, replay nonces, pending and executing commands, receipts, server-received heartbeats, and D1 audit/state reconciliation queues. The audit queue refuses new control actions at capacity. State snapshots coalesce by object key; permanent conflicts move to a visible dead-letter state that blocks agent bootstrap until a newer valid snapshot reconciles it. D1 stores deployment configuration, authorized target, managed rooms, bot-owned ACL records, receipts, and redacted audit events.

## Isolation seams

Every bootstrap, command envelope, heartbeat, and persistent record carries `tenant_id` and `deployment_id`. AgentSession rejects either mismatch before state changes. V1 configures one tenant and deployment; customer onboarding, token custody, tenant administration, quotas, billing, and a hosted console remain outside V1.

## Command path

1. The control Worker validates its complete runtime configuration, rejects structurally invalid signature headers, reads at most 64 KiB, and verifies Discord's Ed25519 signature over the raw body before parsing.
2. It checks application, guild, channel, user, role, and elevated allowlists.
3. AgentSession durably claims each mutating Discord interaction ID for 24 hours, preventing a valid signed request from producing a second command after a retry or Worker restart.
4. The Worker normalizes relay text, writes a content-free audit record or fails closed, signs a tenant/deployment-bound 30-second command, and defers the Discord response.
5. AgentSession rejects wrong tenants or deployments, expired MACs, and replayed nonces, then queues or forwards the command.
6. The Voice Agent completes authenticated bootstrap before processing serialized messages. It asks AgentSession to move the command into the durable executing ledger before side effects. A lost acknowledgement fails closed instead of replaying the effect after restart.
7. The agent verifies the same tenant/deployment boundary, executes only the stored target, returns a receipt, and emits observed state every 15 seconds. Agent sessions expire after five minutes and are closed after 45 seconds without a server-received heartbeat or when their key is retired.
8. AgentSession retains receipts and executing records for 24 hours, updates audit result, and retries D1 audit or state writes through alarms after transient failure.
9. Relay delivery includes a deterministic Discord nonce with enforcement so a retry cannot create a second message through Discord's create-message path.

## Managed rooms

Managed-room setup requires both the deployment feature flag and an exact `MANAGED_GUILD_IDS` allowlist match. `/voice-admin setup` idempotently creates or reuses exact-name `Temporary Voice`, `Join to Create`, and `voice-control` channels. Guild-scoped serialization and persistence checks enforce one room per human owner across creation and claim races. Existing room commands recheck the deployment flag, allowlist, profile, and guild enablement. ACL changes compare the current bot-owned bits with the recorded state and stop on a same-bit staff change instead of overwriting it. A zero-human room is deleted after 15 seconds even when bots remain; a human rejoin cancels deletion. Startup reconciliation applies the same deletion grace after a process restart.

An external Koya or other temporary room is never entered into the managed-room table. Newly authorized external guilds default to `presence_only`; member room commands and bot-owned ACL changes therefore reject that target.
