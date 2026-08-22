# Discord Voice Control Plane

Authorized Discord voice presence, managed temporary rooms, and operator controls with a Cloudflare-backed control plane.

The project uses two Discord applications: an interaction-only `VC Control` app and an official `Voice Rooms` bot. It does not automate user accounts, receive or emit audio, or generate activity to defeat another bot's inactivity policy. A target guild must install the bot and approve the exact test boundary.

## Current status

The source passes its clean local verification and GitHub Actions gates: 77 package tests, 13 migration-backed Workers tests, strict type checking, all workspace builds, wording checks, secret scanning, dependency audit, Worker bundle dry-runs, and both Container image builds in CI.

Discord and Cloudflare runtime behavior is not yet verified. The private `VC Control Lab` server and its `voice-control` and `voice-probe` channels now exist, but neither application identity, credential path, permission grant, command path, nor voice connection has been exercised. The intended personal Cloudflare account is selected; Cloudflare voice hosting is **BLOCKED** until the owner authorizes and completes the Workers Paid upgrade. The Socialize path is **BLOCKED** until staff supplies an approval reference, approved window, approved application and guild IDs, and the exact temporary voice channel. [Test evidence](docs/TEST_EVIDENCE.md) keeps those live claims separate from local and CI results.

## Services

- `apps/control-worker`: Discord HTTP interactions, authorization, Durable Object sessions, and D1 audit/configuration.
- `apps/voice-host-worker`: private Cloudflare Container lifecycle controller.
- `apps/voice-agent`: Discord Gateway, voice connection, managed rooms, member commands, and safe relay.
- `spikes/cloudflare-voice-probe`: isolated UDP, Gateway, DAVE, restart, and lifecycle proof.

The control and voice planes share versioned contracts but not the Discord bot token. The control Worker cannot connect to Discord's Gateway. The private voice host is the only Cloudflare Worker designed to receive the Voice Rooms token.

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

Deployment is intentionally gated. Read [Deployment](docs/DEPLOYMENT.md), [Bot permissions](docs/BOT_PERMISSIONS.md), and the [Runbook](docs/RUNBOOK.md) before connecting an application to a guild.

## Scope

V1 runs one tenant and one deployment while keeping `tenant_id` and `deployment_id` in its contracts and storage. Customer onboarding, billing, token custody, and a hosted console are outside V1.

The bot never subscribes to voice receivers, records or transcribes audio, emits audio, impersonates users, or sends activity intended to defeat another bot's deletion rules.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Hosting decision](docs/ADR-001-voice-agent-hosting.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Privacy](docs/PRIVACY.md)
- [Commands](docs/COMMANDS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Runbook](docs/RUNBOOK.md)
- [Completion audit](docs/COMPLETION_AUDIT.md)
- [Final evidence report](docs/FINAL_REPORT.md)

## License

[MIT](LICENSE)
