# Discord Voice Control Plane

An authorization-first control plane for Discord voice presence, private operator intake, managed temporary rooms, and a local manual-send relay.

The current deployment model uses three independent components:

- `VC Control` is an interaction-only application. Cloudflare handles `/vc`; this application has no bot user or Gateway connection.
- `Voice Rooms` is an official bot installed only in the private control server. In relay-only mode it accepts messages from an exact channel and exact operator allowlists. It is not installed in Socialize.
- `user-rpc-agent` runs beside the official Discord desktop client. After OAuth authorization, the selected desktop account supplies exact voice-channel presence through Discord's documented local RPC interface.

The private bot cannot make a normal Discord account send a message. An accepted message becomes an encrypted local approval request. The account owner reviews it, selects **Prepare in Discord**, manually pastes and sends it, and records the result. `OWNER_CONFIRMED_SENT` is a human receipt, not independently verified Discord delivery.

The project has no user token, user Gateway, automatic user-account message, Discord UI keystroke, synthetic audio, scheduled activity, or anti-AFK mode. It does not claim to preserve a third-party temporary room.

## Current evidence

The source currently passes strict TypeScript checks, 170 package tests, and 23 migration-backed Workers tests. These local results cover relay intake, authenticated ingress, deployment-variable isolation, the encrypted queue, dashboard controls, RPC profile isolation, command grammar, Durable Object recovery, D1 persistence, managed rooms, and the silent official-bot voice state machine.

Live Discord and Cloudflare behavior remains separate from source verification. The private `VC Control Lab` server and requested channels exist. The owner confirmed the locked Voice Rooms installation, and the Developer Portal confirmed Message Content was saved. Protected credentials, command registration, a verified `main` RPC profile, live queue behavior, Worker deployment, and the Container probe remain unverified. Wrangler is authenticated and all Worker configurations pass dry-run validation; Docker is not installed, so no Container image or live voice proof exists.

Socialize is untouched. Its path remains `BLOCKED` until staff supplies an approved window, exact target details, and a supported persistent-room or timeout-exemption mechanism. If no supported mechanism exists after an approved observation, record `TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`.

See [test evidence](docs/TEST_EVIDENCE.md) for the complete proof boundary.

## Services

- `apps/control-worker`: signed Discord interactions, authenticated relay ingress, authorization, Durable Object sessions, and redacted D1 audit/configuration.
- `apps/voice-host-worker`: private Cloudflare Container lifecycle controller.
- `apps/voice-agent`: official-bot Gateway, managed rooms, member commands, and private relay-channel intake.
- `apps/user-rpc-agent`: profile-bound Discord RPC presence plus the encrypted local approval queue and loopback dashboard.
- `packages/agent-client`: shared authenticated control-plane client.
- `spikes/cloudflare-voice-probe`: isolated DNS, HTTPS, Gateway, UDP, DAVE, restart, and lifecycle proof.

The control Worker never receives the Voice Rooms bot token or a local RPC OAuth credential. Cloudflare audit records contain relay hashes and routing metadata, not message bodies. The local queue encrypts pending content with a random per-profile key beneath ignored, user-only runtime storage.

## Commands and relay grammar

Control app: `/vc status|join|leave|reconnect|pause|resume|relay|diagnostics|audit`.

Managed-room bot: `/voice info|name|size|lock|unlock|permit|unpermit|kick|ban|unban|reset|claim`, with opt-in `!voice` and `!v` aliases.

Administration: `/voice-admin setup|status|enable|disable|authorize-target`.

In the private relay channel, ordinary text and exact `!voice` or `!v` commands become approval requests. `permit`, `unpermit`, `kick`, `ban`, `unban`, `reset`, and `claim` require the elevated allowlist and carry an elevated-risk label. Unknown commands, slash-prefixed text, mentions in ordinary text, attachments, embeds, bots, webhooks, edits, and threads are rejected.

`/vc join` and relay intake never accept an arbitrary target. Both use the exact stored authorization.

## Local setup

Requirements: Node.js 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm security:secrets
pnpm security:dependencies
```

Copy `.env.example` to an ignored local configuration file. Keep Discord, Cloudflare, OAuth, and HMAC credentials outside tracked source.

Named RPC profiles live beneath `.runtime/secrets/user-rpc`. Start with `main`. A later `presence` account requires a separate profile, separate OAuth grant, separate queue, and separate key; never rename or overwrite `main`.

```sh
set USER_RPC_PROFILE=main
pnpm user-rpc:authorize
pnpm build
pnpm with:user-rpc-profile -- pnpm --filter @discord-vc-control/user-rpc-agent start
```

Authorization opens Discord's official local OAuth flow and stops for the owner. Login, MFA, CAPTCHA, credential handling, privileged-intent changes, permission grants, and OAuth approval are never automated. The running agent prints its `127.0.0.1` queue URL; `/healthz` exposes only basic process health.

Do not install user-logon startup until the private-lab acceptance matrix passes. Read [Deployment](docs/DEPLOYMENT.md), [Bot permissions](docs/BOT_PERMISSIONS.md), and the [Runbook](docs/RUNBOOK.md) before connecting any application.

## Scope

V1 is one tenant and one deployment, with `tenant_id` and `deployment_id` retained as isolation seams. Customer onboarding, billing, hosted token custody, and a SaaS console are deferred.

Neither agent records, receives, transcribes, or emits audio. The official bot may run managed rooms in an authorized guild; external rooms remain presence-only. The target Discord account is controlled only through documented, OAuth-authorized local RPC and a human final-send step.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Commands](docs/COMMANDS.md)
- [Decisions](docs/DECISIONS.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Privacy](docs/PRIVACY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Runbook](docs/RUNBOOK.md)
- [Completion audit](docs/COMPLETION_AUDIT.md)
- [Final evidence report](docs/FINAL_REPORT.md)

## License

[MIT](LICENSE)
