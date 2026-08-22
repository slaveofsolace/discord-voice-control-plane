# Deployment

Deployment changes Discord applications, Cloudflare Workers, D1, Durable Objects, and Containers. Use a private test guild first. Do not use Socialize as the first live environment.

## 1. Local gate

Use Node 24.19.0 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm clean
pnpm verify
pnpm security:secrets
pnpm security:dependencies
docker build -f Dockerfile.voice-agent -t discord-vc/voice-agent:local .
docker build -f Dockerfile.cloudflare-voice-probe -t discord-vc/voice-probe:local .
```

Docker image checks can run in CI when Docker is unavailable locally. An image build is construction evidence, not live Discord voice evidence.

## 2. Create the Discord test surface

Create a private guild named `VC Control Lab` and two applications:

1. `VC Control`: do not add a bot user. Enable Guild Install with `applications.commands` only.
2. `Voice Rooms`: add the official bot user and install only the selected permission profile from `BOT_PERMISSIONS.md`.

Ordinary already-authenticated portal setup may use authorized Computer control. Stop for login, MFA, CAPTCHA, security or privacy prompts, permission confirmation, client-secret display, or bot-token display. The user completes those steps.

Current helper status: the one authorized recheck stopped before window discovery with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Use the manual portal path unless that helper is repaired separately.

Record application, guild, channel, user, and role IDs in a local ignored environment file. Do not commit them as deployment facts.

## 3. Deploy the control Worker

Wrangler's D1 binding is ID-free in the committed config. Generated account and database IDs remain untracked.

Set required secrets through protected prompts:

```sh
pnpm secrets:control
```

During a planned HMAC rotation, add the previous secret through a separate explicit prompt:

```sh
pnpm secrets:control -- --include-previous
```

Set `AGENT_PREVIOUS_KEY_ID` only when its matching previous secret exists. Export the non-secret allowlist variables from `.env.example`.

For the first D1 auto-provisioning deployment only:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
set INITIAL_D1_PROVISION=true
pnpm deploy:control
```

That flow deploys once to provision the ID-free binding, applies migrations, and deploys again. Later releases must leave `INITIAL_D1_PROVISION` unset so migrations run before the new Worker version:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
pnpm deploy:control
```

Set the Discord Interaction Endpoint URL to `https://<control-worker>/discord/interactions` and let Discord verify the endpoint. Register `/vc` using a short-lived client-credentials token kept only in the calling process:

```sh
pnpm commands:control
```

The control Worker never receives that client secret or a bot token.

## 4. Configure Voice Rooms

Enable Message Content in Discord's portal only if the private deployment sets both prefix flags to `true`. Register `/voice` and `/voice-admin` in the test guild:

```sh
pnpm commands:voice
```

Set `MANAGED_ROOMS_ENABLED=true` only for the private managed-room proof. Put each permitted managed guild's exact ID in `MANAGED_GUILD_IDS`; an empty list permits no guild. `/voice-admin setup` and `enable` fail closed outside that allowlist.

Use `/voice-admin setup`, inspect the created category and channels, then `/voice-admin enable`. Use `/voice-admin authorize-target` only on the exact approved voice channel. A newly authorized external guild receives the presence-only profile unless it is also in the managed-guild allowlist.

## 5. Cloudflare Container gate

Current blocker: Workers Paid is not enabled on the selected personal account. The user must enable it manually. No script in this repository performs a billing action.

After that approval:

1. Set the probe bot token with `pnpm secrets:probe`.
2. Export the exact private test guild and voice channel IDs.
3. Set `DEPLOY_APPROVED=discord-voice-control-plane` and run `pnpm deploy:probe`.
4. Follow sanitized `cloudflare_voice_probe_result`, `cloudflare_voice_probe_shutdown`, and `cloudflare_voice_probe_lifecycle` events.
5. Let the one-minute cron call the named Container repeatedly. Container `sleepAfter` is five minutes and the controller renews activity during a run.
6. Require a complete first report, first clean SIGTERM record, a different second run ID and complete second report, second clean SIGTERM record, then `LIFECYCLE_RESTART_VERIFIED`.

Each complete report must prove:

- outbound DNS and HTTPS;
- raw Gateway WebSocket hello and authenticated bot Gateway ready;
- a fresh authenticated Gateway client after controlled recovery;
- voice-ready protocol state, which is the recorded basis for UDP socket creation, discovery request, discovery response, and Discord IP discovery;
- DAVE negotiation and DAVE renegotiation after a supported controlled voice disconnect/rejoin;
- a stable silent connection before and after rejoin;
- the pinned native DAVE stack;
- no inbound UDP listener requirement or listener opened;
- no audio sent or received; and
- a ready SIGTERM handler followed by clean Container exit evidence.

Any missing field fails the gate. Do not deploy the voice host on Cloudflare after a failed UDP, DAVE, native, restart, or lifecycle result; use the fallback section.

## 6. Deploy the private voice host

`CONTROL_AGENT_WS_URL` is a non-secret `wss://` deployment variable. Set the bot token and current agent key through protected prompts:

```sh
pnpm secrets:voice-host
```

During rotation only:

```sh
pnpm secrets:voice-host -- --include-previous
```

Export `CONTROL_AGENT_WS_URL`, `HOST_ENABLED=true`, the tenant/deployment IDs, feature flags, `MANAGED_GUILD_IDS`, and the current key ID. Set a previous key ID only with its matching secret. Then run:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
pnpm deploy:voice-host
```

The Worker has `workers_dev=false`, no route, a one-minute reconciliation schedule, and one named Container per deployment. Its two-minute `sleepAfter` is renewed by scheduled reconciliation while hosting is enabled. Confirm Container health and a server-received AgentSession heartbeat younger than 45 seconds before issuing a voice command.

## 7. Conventional-host fallback

Copy `deploy/voice-agent.env.example` to ignored `deploy/voice-agent.env`, provide secrets through the host's secret manager, and retain the same exact `MANAGED_GUILD_IDS` and `CONTROL_AGENT_WS_URL` values. Build and run:

```sh
docker compose -f deploy/docker-compose.yml up -d --build voice-agent
```

For systemd, install the repository under `/opt/discord-voice-control-plane`, install `deploy/discord-voice-agent.service`, prebuild the image, and enable the service. The agent still authenticates to the same Cloudflare control Worker. The fallback does not expand its Discord permissions or target authorization.

## 8. Test and target rollout

Complete every row in `TEST_EVIDENCE.md` in `VC Control Lab`, including restart, clean SIGTERM, moderator removal, ACL preservation, and relay redelivery. Only then request Socialize staff authorization using the supplied forms. Keep target results `UNVERIFIED` until observed during the approved window.
