# Commands

## Private relay channel

Only new human messages in the exact configured control guild and relay channel are considered. The sender must match `CONTROL_OPERATOR_USER_IDS` or `CONTROL_OPERATOR_ROLE_IDS`. Bots, webhooks, edits, attachments, embeds, threads, empty messages, and messages from any other context are rejected or ignored.

Accepted requests receive a request ID plus status and cancel controls. Status never exposes queued content. Only the originator or an elevated operator may cancel.

Ordinary chat is NFC-normalized and limited to 1–1,000 characters. Control characters, bidirectional controls, slash-prefixed text, Discord mention syntax, mass mentions, and unknown bang commands are rejected.

`!voice` and `!v` are exact aliases:

```text
!voice info
!voice name <name>
!voice size <1-99|unlimited>
!voice lock
!voice unlock

ELEVATED RISK
!voice permit <user>
!voice unpermit <user>
!voice kick <user>
!voice ban <user>
!voice unban <user>
!voice reset
!voice claim
```

The first five command forms use the operator allowlist. The elevated-risk forms also require `CONTROL_ELEVATED_USER_IDS` or `CONTROL_ELEVATED_ROLE_IDS`. A user argument is exactly one Discord user mention or a 17–20 digit snowflake. A command mention is parsed as data; ordinary text cannot contain mentions.

Every accepted item enters the local encrypted queue as `PENDING_USER_APPROVAL`. It does not select a channel, alter the clipboard, or send through Discord until the owner chooses **Prepare in Discord**. The owner then manually pastes and sends.

## Control application

`/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit`

Reconnect and audit require the elevated allowlist. Audit defaults to 10 rows and caps at 50. `/vc join` has no guild or channel argument and uses only the stored target. `/vc relay` remains an administrative fallback; the normal private-control path is the locked relay channel and local approval queue.

## Managed-room application

`/voice info|name|size|lock|unlock|permit|unpermit|kick|ban|unban|reset|claim`

The reusable bot exposes the same actions through opt-in `!voice` and `!v` prefixes. Prefix arguments accept only a mention or snowflake. Commands operate only on the invoker's current managed room. `kick` disconnects from the channel; `ban` denies Connect for that channel and disconnects if present. Neither performs a guild kick or ban.

`/voice-admin setup|status|enable|disable|authorize-target`

The private relay-only deployment disables managed-room and prefix behavior. Message Content is enabled only for that private intake instance; public defaults remain slash-command-only.
