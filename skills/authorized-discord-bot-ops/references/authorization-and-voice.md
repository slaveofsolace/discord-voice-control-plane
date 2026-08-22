# Authorization and voice boundary

Use current official Discord documentation as the source of truth.

## Authorization record

Before a live guild action, capture:

- application ID and bot user ID;
- guild and exact channel IDs;
- authorizing staff user or role;
- approved permission profile and operating behavior;
- testing window and incident/removal contact;
- whether persistent voice presence is supported without synthetic activity.

An interaction-only control app can use the `applications.commands` install scope without a bot user in the guild. Register commands using a short-lived client-credentials token with `applications.commands.update`; do not put that credential in the runtime Worker.

## Target guild installation

- A server-installed application must be approved by a member who currently holds Discord's `MANAGE_GUILD` permission or Administrator. A staff title without that effective permission is not enough.
- The approver and installer may be different people. Record both, lock the OAuth2 install URL to the exact authorized guild, and use the presence-only permission bitset for a third-party temporary room.
- A bot user is Discord's dedicated automation identity and cannot accept a normal invite. Never replace a missing guild install with a user token, a standard-user session, or self-bot automation.
- If no authorized installer exists, stop and report the installation blocker. Do not broaden permissions or change identity type to work around it.

## Voice invariants

- Connect as an official bot, self-muted and self-deafened.
- Use a maintained library with current DAVE support and prove negotiation live.
- Do not subscribe to voice receivers, inspect packets, record, transcribe, or generate audio.
- Reconnect only after transient transport failures. Block reconnect after moderator actions, permission loss, deletion, explicit leave/pause, or repeated protocol/authentication failure.
- Third-party temporary channels are presence-only unless staff explicitly authorizes management. Do not invoke or imitate another application's commands.

## Permission profiles

Presence-only: View Channel, Connect, Send Messages, Read Message History.

Managed rooms additionally require Manage Channels, Manage Roles for overwrites, and Move Members. Never request Administrator or guild kick/ban permissions for channel-scoped member controls.
