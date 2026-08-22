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

Voice Host is not routed publicly. It alone reads the bot token and passes it to one named Container. The Voice Agent opens outbound Discord Gateway, voice WebSocket, and UDP connections. It exposes only a Container-internal HTTP health endpoint.

AgentSession is one SQLite-backed Durable Object per deployment. It stores desired and observed state, replay nonces, pending commands, receipts, server-received heartbeats, and bounded ordered D1 audit and state outboxes. D1 stores deployment configuration, authorized target, managed rooms, bot-owned ACL records, receipts, and redacted audit events.

## Isolation seams

Every bootstrap, command envelope, heartbeat, and persistent record carries `tenant_id` and `deployment_id`. AgentSession rejects either mismatch before state changes. V1 configures one tenant and deployment; customer onboarding, token custody, tenant administration, quotas, billing, and a hosted console remain outside V1.

## Command path

1. The control Worker verifies Discord's Ed25519 signature over the raw body before parsing.
2. It checks application, guild, channel, user, role, and elevated allowlists.
3. It normalizes relay text, writes a content-free audit record, signs a tenant/deployment-bound 30-second command, and defers the Discord response.
4. AgentSession rejects wrong tenants or deployments, expired MACs, and replayed nonces, then queues or forwards the command.
5. The Voice Agent completes authenticated bootstrap before processing serialized messages, verifies the same tenant/deployment boundary, executes only the stored target, returns a receipt, and emits observed state every 15 seconds.
6. AgentSession retains the receipt for 24 hours, updates audit result, and retries ordered D1 audit or state writes through alarms after transient failure.
7. Relay delivery includes a deterministic Discord nonce with enforcement so a retry cannot create a second message through Discord's create-message path.

## Managed rooms

Managed-room setup requires both the deployment feature flag and an exact `MANAGED_GUILD_IDS` allowlist match. `/voice-admin setup` idempotently creates `Temporary Voice`, `Join to Create`, and `voice-control`. Joining the lobby creates or reuses one room per human owner. The bot tracks only its own room IDs and ACL subjects. A zero-human room is deleted after 15 seconds even when bots remain; a human rejoin cancels deletion. Startup reconciliation applies the same deletion grace after a process restart.

An external Koya or other temporary room is never entered into the managed-room table. Newly authorized external guilds default to `presence_only`; member room commands and bot-owned ACL changes therefore reject that target.
