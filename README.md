# Discord Voice Control Plane

An official Discord bot and Cloudflare control plane for authorized voice-channel presence, managed temporary rooms, safe text relay, and operator diagnostics.

This repository does not automate user accounts. It does not send synthetic audio, messages, reactions, or presence changes to defeat inactivity rules. A target guild must install the official bot and approve its behavior.

## Current status

The implementation passes the recorded local build, unit, Workers integration, wording, secret, and dependency gates. Discord and Cloudflare live behavior is not yet verified. The Socialize path is **BLOCKED** until staff supplies an approval reference, an approved test window, and the exact target channel. See `docs/TEST_EVIDENCE.md` for the evidence boundary.

## Services

- `apps/control-worker`: Discord HTTP interactions, authorization, Durable Object sessions, and D1 audit/configuration.
- `apps/voice-host-worker`: private Cloudflare Container lifecycle controller.
- `apps/voice-agent`: Discord Gateway, voice connection, managed rooms, member commands, and safe relay.
- `spikes/cloudflare-voice-probe`: isolated UDP, Gateway, DAVE, restart, and lifecycle proof.

The public template starts with prefix commands and managed rooms disabled. Slash commands do not need Message Content. A deployment that enables `!voice` or `!v` must also enable Discord's Message Content privileged intent.

## Commands

Control app: `/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit`.

Voice bot: `/voice info|name|size|lock|unlock|permit|unpermit|kick|ban|unban|reset|claim`. The same member actions are available through `!voice` and `!v` only when prefix support is enabled.

Administration: `/voice-admin setup|status|enable|disable|authorize-target`.

`/vc join` has no guild or channel argument. It can use only the exact target recorded by an authorized administrator.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:worker
pnpm verify
```

Copy `.env.example` to a local secret file that is excluded by `.gitignore`. Do not put a Discord token or Cloudflare credential in tracked files.

Deployment is intentionally gated. Read `docs/DEPLOYMENT.md`, `docs/BOT_PERMISSIONS.md`, and `docs/RUNBOOK.md` before connecting an application to a guild.

## Scope

V1 runs one tenant and one deployment while keeping `tenant_id` and `deployment_id` in its contracts and storage. Customer onboarding, billing, token custody, and a hosted console are outside V1.

The bot never subscribes to voice receivers, records or transcribes audio, emits audio, impersonates users, or sends activity intended to defeat another bot's deletion rules.

## License

MIT
