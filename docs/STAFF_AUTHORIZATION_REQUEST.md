# Staff authorization request

We request a bounded test of one named member account in one staff-approved temporary voice channel. Voice Rooms remains in the private control server and is not installed in Socialize. The target account uses the official Discord desktop client; a Discord-approved local RPC application may select the exact voice or text channel after that user completes OAuth authorization.

## Requested operations

- Confirm the exact guild, RPC application, member account, voice-channel, and voice-chat IDs.
- Allow that named member to join, leave, and expose redacted selected-channel diagnostics during an agreed window.
- Optionally allow one ordinary message submitted through the private queue. The account owner reviews and prepares it locally, then manually pastes and sends it.
- Observe the third-party room's normal deletion behavior without synthetic activity.

The adapter will not invoke another bot, request a user token, open a user Gateway, drive the Discord UI, automatically send a message, receive or record audio, send audio, modify the temporary channel, change ownership or permissions, schedule activity, or attempt to defeat inactivity rules. `OWNER_CONFIRMED_SENT` is only the owner's receipt and is not verified Discord delivery. A staff move, disconnect, permission removal, or target deletion blocks reconnection until an authorized operator rechecks the cause.

## Requested response

Please supply:

- Approving staff member and role.
- Approval reference and exact date/time window.
- Approved RPC application, member-account, guild, voice-channel, and voice-chat IDs.
- Confirmation that Discord has granted the application RPC partner/tester access; Socialize staff is not asked to grant or waive that Discord requirement.
- Allowed operator IDs and manual-message boundary.
- Confirmation that no synthetic activity is authorized.
- Any supported persistent or exempt configuration that staff wants tested.
- Required local-agent stop time.
- An incident contact and removal contact.
- Expected action if the bot is unexpectedly moved, disconnected, or denied permission.

If the room needs a documented persistent or exempt mode, staff must configure it or explicitly authorize the ordinary administrative mechanism. The project will not guess or simulate one.

The official bot is deliberately private-control-only. The requested target path is limited to Discord's documented local RPC interface and a human final send. If Discord RPC access is not granted, there is no supported automatic normal-user connection or message-send fallback in this project. No retention claim exists without a staff-supported persistent-room or timeout-exemption mechanism.
