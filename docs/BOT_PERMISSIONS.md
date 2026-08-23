# Bot permissions

## VC Control

Install with `applications.commands` only. Do not add a bot user or the `bot` scope. Restrict the application and `/vc` in the private control guild through Discord integration settings and Worker allowlists.

## Voice Rooms: private relay-only deployment

Voice Rooms is installed only in `VC Control Lab` for the authorized user-relay deployment. Request:

- View Channel
- Connect
- Send Messages
- Read Message History

Enable Guilds, Guild Messages, and the Message Content privileged intent only for this private instance. Set `CONTROL_RELAY_ENABLED=true` and `CONTROL_RELAY_ONLY=true`. Exact guild, channel, operator, elevated-operator, and application allowlists are mandatory.

Relay-only mode does not open the authenticated agent WebSocket, run managed rooms, interpret public prefix commands, or join Socialize. The OAuth-authorized desktop account supplies target voice presence.

## Voice Rooms: reusable managed-room profile

The reusable managed-room deployment adds:

- Manage Channels
- Manage Roles
- Move Members

Never request Administrator, Manage Guild, Kick Members, Ban Members, Manage Webhooks, Mute Members, Deafen Members, priority speaker, or speaking permissions. A human installer must independently hold Manage Server or Administrator to approve a server-installed app.

Public defaults leave Message Content, relay intake, prefix commands, and managed rooms disabled. Slash commands and voice-state handling do not require Message Content.

## Authorized local RPC account

The Windows local adapter requests no guild permission bitfield and installs no bot. It requires Discord RPC partner/tester access, explicit user OAuth for `rpc` and `identify`, an expected user ID, one allowed guild, and exact stored voice/text targets.

The adapter cannot send a guild message or inject audio. It prepares an approved draft with `clip.exe`; the owner manually pastes and sends. A future account requires a separate named profile and fresh OAuth grant.

## Managed-room command effects

`kick` disconnects a member from the voice channel. `ban` denies Connect only on that managed channel and disconnects the member if present. Neither performs a guild kick or ban.

`reset` edits only the Connect/View bits recorded as bot-owned. It preserves unrelated staff subjects and permission bits.
