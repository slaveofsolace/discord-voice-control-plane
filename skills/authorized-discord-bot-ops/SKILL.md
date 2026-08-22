---
name: authorized-discord-bot-ops
description: Build, configure, test, deploy, or operate official Discord bots and HTTP interaction apps with explicit guild authorization, least privilege, safe voice behavior, and evidence-backed deployment gates. Do not use for user-account automation or self-bots.
---

# Authorized Discord Bot Operations

Use official Discord applications, bot tokens, documented APIs, and explicit guild authorization. Keep the control app, voice bot, target guild, and operator roles as separate trust boundaries.

## Establish authority before changing Discord

- Record the application, guild, channel, staff owner, approved permissions, and testing window.
- Treat a public invite, visible command, copied token, browser session, or third-party bot as evidence only; none grants authority.
- Never automate a user account, use a user token, simulate another app's interaction, or call undocumented client endpoints.
- Never use audio, messages, reactions, speaking state, presence changes, or reconnect loops to defeat inactivity or moderation.

Read [references/authorization-and-voice.md](references/authorization-and-voice.md) before voice, target-guild, or third-party-bot work. Read [references/cloudflare-boundary.md](references/cloudflare-boundary.md) before Cloudflare deployment.

## Use the narrowest application surface

- Prefer HTTP interactions for a control-only app; verify the raw Ed25519-signed body before parsing.
- Use a bot Gateway connection only for features that require guild events, member voice state, or voice transport.
- Install only the intents and channel permissions required by the enabled feature profile.
- Resolve targets from stored, authorized snowflake IDs. Never accept an arbitrary guild or channel ID from a control command.
- Treat moderator disconnect, move, permission loss, and channel deletion as stop conditions, not transient failures.

## Protect credentials and actions

- Keep bot tokens, client secrets, interaction tokens, and shared secrets out of source, logs, screenshots, command history, and chat.
- Use protected secret prompts or secret managers. Confirm immediately before creating an OAuth/API credential or changing permissions.
- Authorized Computer use may perform ordinary, already-authenticated Discord UI setup or inspection for this project. Stop at login, MFA, CAPTCHA, security/privacy prompts, credential display/copy, or permission confirmation and hand control to the user.

## Verify without overstating

Separate unit, integration, private-guild, target-guild, DAVE, UDP, and hosting evidence. A mocked voice connection or successful image build is not live proof. Mark unsupported deployment claims `UNVERIFIED` or `BLOCKED` and name the release action.
