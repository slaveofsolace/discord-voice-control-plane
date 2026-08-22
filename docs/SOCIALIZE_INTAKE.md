# Socialize intake

Status: `BLOCKED`.

Exact external blocker: the user confirmed that an official bot install is unavailable. The remaining documented path lacks Discord RPC partner/tester access, a persistent authorized Discord desktop session, a staff approval reference and test window, confirmed application/account/guild facts, the exact temporary voice-channel and chat IDs, operator scope, and an incident/removal contact. No target action is authorized until every applicable field is confirmed.

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
- Authorized local RPC application ID:
- Discord RPC partner/tester access confirmed: `YES / NO`
- Authorized desktop Discord user ID:
- Local profile/user binding verified: `YES / NO`

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
- Approved local RPC application ID:
- Approved member account user ID:
- Approved target guild ID:
- Approved target voice channel ID:
- Approved voice-channel chat ID, if different:
- Allowed control operators:
- Approved manual message count and content class:
- Required removal time:
- Incident contact:
- Removal contact:
- Expected staff response to an unexpected move or disconnect:
- Confirmation that no synthetic activity is authorized: `YES / NO`
- Confirmation that ordinary prefix-command support is allowed or not applicable: `YES / NO / N/A`

## Approved test boundary

Allowed only when staff records it above: the explicitly named member account joining and leaving through Discord's approved local RPC, status, redacted diagnostics, and a local draft handoff during the approved window. The final Discord message, if approved, is pasted and sent manually by that user.

Not allowed: invoking a third-party bot; running managed-room commands; changing ownership, names, limits, or ACLs; synthetic messages, audio, reactions, joins, or presence; arbitrary target IDs; raw user tokens; user Gateway connections; Discord UI automation; automatic user-message sending; or continuing after staff moves or disconnects the account.

Discord RPC access is a separate Discord approval/tester gate that Socialize staff cannot waive. If it is not granted, record `TARGET USER PRESENCE BLOCKED — DISCORD RPC ACCESS NOT GRANTED`. If the local Discord desktop cannot remain running, record `TARGET USER PRESENCE BLOCKED — NO SUPPORTED LOCAL HOST`.

## Observation record

Current result: `UNVERIFIED`.

- Authorization rechecked at:
- Exact target rechecked at:
- Authorized member joined at:
- Draft staged at:
- User manually sent at and resulting message ID, if approved:
- Staff or moderator action observed:
- Room deleted or retained at:
- Actual elapsed interval:
- Supported persistence/exemption tested:
- Local agent stopped and OAuth profile revoked at:
- Observation label:

If normal authorized member presence is insufficient and staff supplies no supported persistent or exempt configuration, record exactly:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
