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

Generate a guild-locked shortcut only after staff records the exact authorized target:

```text
VOICE_ROOMS_APPLICATION_ID=<official application snowflake>
AUTHORIZED_TARGET_GUILD_ID=<staff-approved guild snowflake>
VOICE_INSTALL_PROFILE=presence-only
VOICE_INSTALL_OUTPUT_NAME=voice-rooms-target.url
pnpm install:url:voice
```

The command writes an ignored `.runtime/*.url` file with `disable_guild_select=true` and does not print either ID. The person who approves it must currently hold Discord's Manage Server (`MANAGE_GUILD`) permission or Administrator in that guild. A staff title without that effective permission is insufficient.

This profile remains valid for guilds that can install the official bot. The user confirmed that Socialize cannot use this route; do not keep treating an installer as its pending solution.

## Voice Rooms: managed rooms

Presence-only permissions plus:

- Manage Channels
- Manage Roles
- Move Members

Permission integer: `286329872`. Verify it against the current Discord permission calculator and the application's install page before approving installation.

Never request Administrator, Manage Guild, Kick Members, Ban Members, Manage Webhooks, Mute Members, Deafen Members, or priority/speaking permissions.

Those forbidden permissions refer to the bot's requested permission bitset. Discord separately requires the human installer to hold Manage Server (`MANAGE_GUILD`) or Administrator so they can approve any server-installed app. Installing the bot does not grant that human permission to the bot.

The human permission used to invoke an administration command is separate from the bot installation profile. Managed-room administration requires Manage Channels. Exact target authorization requires either a configured `TARGET_APPROVER_USER_IDS` match or the invoking staff member's Manage Guild permission; this does not grant Manage Guild to the bot.

## Gateway intents

Always: Guilds and Guild Voice States.

Only when prefixes are explicitly enabled: Guild Messages and the Message Content privileged intent. Slash commands and voice state handling do not need Message Content.

## Authorized local RPC adapter

The optional Windows-local adapter requests no guild permission bitfield and installs no bot. It requires Discord RPC partner/tester access plus explicit user OAuth authorization for `rpc` and `identify`, an expected user ID, one allowed guild, and the exact target stored by the control plane. It does not accept a Discord user token or use Gateway intents. It cannot send a message or inject audio; relay stages a local draft for manual send.

## Room command effects

`kick` performs a voice disconnect only. `ban` denies Connect on the managed channel and disconnects the member if present. Neither operation kicks or bans a guild member.

`reset` edits only the Connect/View entries that this bot recorded for owner, permits, bans, and lock. Other staff overwrite subjects and unrelated permission bits are preserved.
