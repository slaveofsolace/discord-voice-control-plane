# Staff authorization request

We request a bounded test of the official `Voice Rooms` bot in one staff-approved temporary voice channel.

## Requested operations

- Install the bot with the documented presence-only permission profile.
- Confirm the exact guild, application, bot-user, voice-channel, and voice-chat IDs.
- Allow join, leave, status, redacted diagnostics, and one ordinary plain-text relay during an agreed window.
- Observe the third-party room's normal deletion behavior without synthetic activity.
- Confirm whether ordinary `!voice` or `!v` prefix-command support is allowed in the private test guild. Prefixes are not required for the target-guild presence test and remain disabled unless explicitly approved.

The bot will not invoke another bot, automate a user account, receive or record audio, send audio, modify the temporary channel, change ownership or permissions, or attempt to defeat inactivity rules. A staff move, disconnect, permission removal, or target deletion blocks automatic reconnection until an authorized operator rechecks the cause.

## Requested response

Please supply:

- Approving staff member and role.
- Approval reference and exact date/time window.
- Approved application, bot-user, guild, voice-channel, and voice-chat IDs.
- Allowed operator IDs and relay boundary.
- Confirmation that no synthetic activity is authorized.
- Any supported persistent or exempt configuration that staff wants tested.
- Required bot removal time.
- An incident contact and removal contact.
- Expected action if the bot is unexpectedly moved, disconnected, or denied permission.

If the room needs a documented persistent or exempt mode, staff must configure it or explicitly authorize the ordinary administrative mechanism. The project will not guess or simulate one.
