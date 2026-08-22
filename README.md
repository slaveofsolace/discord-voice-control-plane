# Discord Voice Control Plane

Authorized Discord voice presence, managed temporary rooms, and operator controls with a Cloudflare-backed control plane.

The primary deployment uses two Discord applications: an interaction-only `VC Control` app and an official `Voice Rooms` bot. An optional Windows-local adapter can instead use Discord's approved RPC interface to control the currently authorized Discord desktop user. Neither adapter receives or emits audio or generates activity to defeat another bot's inactivity policy.

Voice Rooms always authenticates as Discord's dedicated bot user. The local adapter never accepts a Discord user token, opens a user Gateway session, or drives the Discord UI. It requires Discord RPC partner/tester access, the official desktop client, explicit user OAuth authorization, and a profile-bound expected user ID. Discord RPC can select voice and text channels, but it cannot send a guild message or inject microphone input. In local RPC mode, relay therefore selects the exact authorized text channel and stages a sanitized clipboard draft with a `USER_SEND_REQUIRED` receipt.

## Current status

The current source passes strict type checking, 101 package tests, and 18 migration-backed Workers tests. Published `main` commit `3780f4a` passed GitHub Actions run `32566678045`, including the complete verification gate, secret scan, dependency audit, both Container image builds, and the control Worker bundle.

Discord and Cloudflare runtime behavior is not yet verified. The private `VC Control Lab` server and its `voice-control` and `voice-probe` channels exist. `VC Control` and `Voice Rooms` exist as Discord applications; VC Control is installed in the lab, and Voice Rooms is staged at its final exact-permission consent. Their public identifiers are stored only in an ignored local runtime file. No credential was opened or copied. Message Content, the bot token, Voice Rooms installation, commands, voice, and local RPC approval remain unexercised. Workers Paid is active on the selected personal Cloudflare account, so billing no longer blocks Container deployment. The user confirmed that an official bot install is unavailable in Socialize. That target path is now **BLOCKED** on Discord RPC partner/tester access, a persistent authorized desktop session, staff-approved exact target details, and live observation. [Test evidence](docs/TEST_EVIDENCE.md) keeps those live claims separate from local and CI results.

## Services

- `apps/control-worker`: Discord HTTP interactions, authorization, Durable Object sessions, and D1 audit/configuration.
- `apps/voice-host-worker`: private Cloudflare Container lifecycle controller.
- `apps/voice-agent`: Discord Gateway, voice connection, managed rooms, member commands, and safe relay.
- `apps/user-rpc-agent`: optional Windows-local, profile-bound Discord RPC voice adapter and manual-send draft handoff.
- `packages/agent-client`: shared authenticated Cloudflare command client used by both agent types.
- `spikes/cloudflare-voice-probe`: isolated probe image and report contract for UDP, Gateway, DAVE, restart, and lifecycle proof.

The control and voice planes share versioned contracts but not the Discord bot token. The control Worker cannot connect to Discord's Gateway. The private voice host is the only Cloudflare Worker designed to receive the Voice Rooms token; it starts both the production agent Container and the separately named probe Container.

The public template starts with prefix commands and managed rooms disabled. Slash commands do not need Message Content. A deployment that enables `!voice` or `!v` must also enable Discord's Message Content privileged intent.

## Commands

Control app: `/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit`.

Voice bot: `/voice info|name|size|lock|unlock|permit|unpermit|kick|ban|unban|reset|claim`. The same member actions are available through `!voice` and `!v` only when prefix support is enabled.

Administration: `/voice-admin setup|status|enable|disable|authorize-target`.

`/vc join` has no guild or channel argument. It can use only the exact target recorded by an authorized administrator. `/vc relay` sends through the official bot adapter; the local RPC adapter stages a clipboard draft and reports that a user send is still required.

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

The optional local RPC adapter uses named profiles under ignored `.runtime/secrets/user-rpc`. `pnpm user-rpc:authorize` opens Discord's official local authorization flow and stops for the user's approval. `pnpm with:user-rpc-profile -- <command>` refreshes the selected OAuth profile and injects it only into the child process. A second Discord user is added by authorizing a different profile name; the control-plane code does not change.

Deployment is intentionally gated. Read [Deployment](docs/DEPLOYMENT.md), [Bot permissions](docs/BOT_PERMISSIONS.md), and the [Runbook](docs/RUNBOOK.md) before connecting an application to a guild.

## Scope

V1 runs one tenant and one deployment while keeping `tenant_id` and `deployment_id` in its contracts and storage. Customer onboarding, billing, token custody, and a hosted console are outside V1.

Neither agent subscribes to voice receivers, records or transcribes audio, emits audio, impersonates a user, or sends activity intended to defeat another bot's deletion rules. The local adapter performs only documented OAuth-authorized RPC commands against a locally running Discord desktop client.

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
