# Commands

## Member help

```text
Voice Help

Commands
!voice info | View your channel settings
!voice name <name> | Rename your channel
!voice size <amount/unlimited> | Set your channel size
!voice lock | Make your channel private
!voice unlock | Make your channel public
!voice permit <user> | Allow a specific user to join
!voice unpermit <user> | Remove a user from the allowed list
!voice kick <user> | Disconnect a user from your channel
!voice ban <user> | Ban a user from your channel
!voice unban <user> | Unban a user from your channel
!voice reset | Reset your voice settings to default
!voice claim | Claim ownership of the channel you're in

Prefer shortcuts? Use !v instead of !voice
```

The same actions are registered under `/voice`. Prefix user arguments accept only a Discord mention or a 17-to-20-digit snowflake. Commands always use the invoking member's current managed room.

## Administration

`/voice-admin setup|status|enable|disable|authorize-target`

## Control

`/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit`

Reconnect and audit require the elevated allowlist. Audit defaults to 10 rows and caps at 50.
