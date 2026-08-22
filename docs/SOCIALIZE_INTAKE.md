# Socialize intake

Status: `BLOCKED`.

Exact external blocker: Socialize staff has not supplied an approval reference, approved test window, approved application and bot IDs, target guild ID, exact temporary voice-channel ID, operator list, or removal contact. No target action is authorized until every applicable field is confirmed by staff.

Do not infer missing values from screenshots, display names, another guild, or an unconfirmed application match.

## Target and creator facts

- Target guild name:
- Target guild ID:
- Temporary room name:
- Exact temporary voice channel ID:
- Voice-channel chat ID, if different:
- Creator application display name:
- Creator application ID:
- Creator bot user ID:
- Candidate Koya or other creator match:
- Match confirmed by staff: `YES / NO`
- Normal room creation mechanism:
- Staff-documented management surface:
- Staff-documented deletion trigger:
- Staff-documented deletion interval:

## Retention conditions

- Does a bot-only room count as empty?
- Does a muted or deafened human count as present?
- Does the owner leaving trigger deletion?
- Does another human joining cancel deletion?
- Supported persistent-room configuration:
- Supported bot exemption:
- Supported API or ordinary administrative command:
- Who may configure or revoke that mechanism?

Do not create synthetic audio, messages, reactions, joins, or presence to test or influence retention.

## Staff authority and contacts

- Approving staff member and role:
- Approval reference:
- Approved date and time window:
- Approved `VC Control` application ID:
- Approved `Voice Rooms` application ID:
- Approved Voice Rooms bot user ID:
- Approved target guild ID:
- Approved target voice channel ID:
- Approved voice-channel chat ID, if different:
- Allowed control operators:
- Approved ordinary relay count and content class:
- Required removal time:
- Incident contact:
- Removal contact:
- Expected staff response to an unexpected move or disconnect:
- Confirmation that no synthetic activity is authorized: `YES / NO`
- Confirmation that ordinary prefix-command support is allowed or not applicable: `YES / NO / N/A`

## Approved test boundary

Allowed only when staff records it above: official-bot join, leave, status, redacted diagnostics, and one ordinary plain-text relay during the approved window.

Not allowed: invoking a third-party bot; running managed-room commands; changing ownership, names, limits, or ACLs; synthetic messages, audio, reactions, joins, or presence; arbitrary target IDs; user-account automation; or continuing after staff moves, disconnects, or removes the bot.

## Observation record

Current result: `UNVERIFIED`.

- Authorization rechecked at:
- Exact target rechecked at:
- Voice Rooms joined at:
- Relay sent at and resulting message ID:
- Staff or moderator action observed:
- Room deleted or retained at:
- Actual elapsed interval:
- Supported persistence/exemption tested:
- Bot removed at:
- Observation label:

If normal official-bot presence is insufficient and staff supplies no supported persistent or exempt configuration, record exactly:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
