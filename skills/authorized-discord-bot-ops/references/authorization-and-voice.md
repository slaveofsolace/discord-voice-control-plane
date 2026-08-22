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

## Voice invariants

- Connect as an official bot, self-muted and self-deafened.
- Use a maintained library with current DAVE support and prove negotiation live.
- Do not subscribe to voice receivers, inspect packets, record, transcribe, or generate audio.
- Reconnect only after transient transport failures. Block reconnect after moderator actions, permission loss, deletion, explicit leave/pause, or repeated protocol/authentication failure.
- Third-party temporary channels are presence-only unless staff explicitly authorizes management. Do not invoke or imitate another application's commands.

## Permission profiles

Presence-only: View Channel, Connect, Send Messages, Read Message History.

Managed rooms additionally require Manage Channels, Manage Roles for overwrites, and Move Members. Never request Administrator or guild kick/ban permissions for channel-scoped member controls.
