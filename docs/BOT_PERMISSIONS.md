# Bot permissions

## VC Control

Install the application with `applications.commands` only. Do not add a bot user or the `bot` scope. Restrict the application and `/vc` command in the private control guild through Discord's integration settings and the Worker allowlists.

## Voice Rooms: presence-only

- View Channel
- Connect
- Send Messages
- Read Message History

Use this profile for an existing third-party temporary voice channel. Managed-room commands will reject that channel.

Permission integer: `1117184` (`ViewChannel | Connect | SendMessages | ReadMessageHistory`). Verify the generated Discord install URL before approval.

## Voice Rooms: managed rooms

Presence-only permissions plus:

- Manage Channels
- Manage Roles
- Move Members

Permission integer: `286329872`. Verify it against the current Discord permission calculator and the application's install page before approving installation.

Never request Administrator, Manage Guild, Kick Members, Ban Members, Manage Webhooks, Mute Members, Deafen Members, or priority/speaking permissions.

The human permission used to invoke an administration command is separate from the bot installation profile. Managed-room administration requires Manage Channels. Exact target authorization requires either a configured `TARGET_APPROVER_USER_IDS` match or the invoking staff member's Manage Guild permission; this does not grant Manage Guild to the bot.

## Gateway intents

Always: Guilds and Guild Voice States.

Only when prefixes are explicitly enabled: Guild Messages and the Message Content privileged intent. Slash commands and voice state handling do not need Message Content.

## Room command effects

`kick` performs a voice disconnect only. `ban` denies Connect on the managed channel and disconnects the member if present. Neither operation kicks or bans a guild member.

`reset` edits only the Connect/View entries that this bot recorded for owner, permits, bans, and lock. Other staff overwrite subjects and unrelated permission bits are preserved.
