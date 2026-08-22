# Deployment

Deployment changes Discord applications, Cloudflare Workers, D1, Durable Objects, and Containers. Use a private test guild first. Do not use Socialize as the first live environment.

## 1. Local gate

Use Node 24.19.0 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm security:secrets
pnpm security:dependencies
docker build -f Dockerfile.voice-agent -t discord-vc/voice-agent:local .
docker build -f Dockerfile.cloudflare-voice-probe -t discord-vc/voice-probe:local .
```

Docker image checks can run in CI when Docker is unavailable locally.

## 2. Create the Discord test surface

Create a private guild named `VC Control Lab` and two applications:

1. `VC Control`: do not add a bot user. Enable Guild Install with `applications.commands` only.
2. `Voice Rooms`: add the official bot user and install only the selected permission profile from `BOT_PERMISSIONS.md`.

Ordinary already-authenticated portal setup may use authorized Computer control. Stop for login, MFA, CAPTCHA, security or privacy prompts, permission confirmation, client-secret display, or bot-token display. The user completes those steps.

Current helper status: the execution recheck stopped before window discovery with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Use the manual portal path unless that helper is repaired separately.

Record application, guild, channel, user, and role IDs in a local ignored environment file. Do not commit them as deployment facts.

## 3. Deploy the control Worker

Wrangler's D1 binding is ID-free in the committed config. Deployment variables are passed at invocation; generated account and database IDs remain untracked.

Set the three Worker secrets through protected prompts:

```sh
pnpm secrets:control
```

Then export the non-secret allowlist variables and run:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
pnpm deploy:control
```

The deploy script publishes the Worker and applies D1 migrations. Set the Discord Interaction Endpoint URL to `https://<control-worker>/discord/interactions` and let Discord verify the endpoint.

Register `/vc` using a short-lived client-credentials token. Keep the client secret only in the calling process:

```sh
pnpm commands:control
```

The control Worker never receives that client secret or a bot token.

## 4. Configure Voice Rooms

Enable Message Content in Discord's portal only if the private deployment will set both prefix flags to `true`. Register `/voice` and `/voice-admin` in the test guild:

```sh
pnpm commands:voice
```

Use `/voice-admin setup`, inspect the created category and channels, then `/voice-admin enable`. Use `/voice-admin authorize-target` only on the exact approved voice channel.

## 5. Cloudflare Container gate

Current blocker: Workers Paid has not been enabled on the selected personal account. The user must enable it manually. No script in this repository performs a billing action.

After that approval:

1. Set the probe bot token with `pnpm secrets:probe`.
2. Export the exact test guild and voice channel IDs.
3. Set `DEPLOY_APPROVED=discord-voice-control-plane` and run `pnpm deploy:probe`.
4. Follow sanitized `cloudflare_voice_probe_result` and `cloudflare_voice_probe_lifecycle` logs.
5. Require a complete first run, graceful stop, a different second run ID, and `LIFECYCLE_RESTART_VERIFIED`.

The probe makes an official silent voice connection. It sends no audio, messages, reactions, or synthetic presence. `VoiceConnectionStatus.Ready` is evidence that Discord's UDP IP discovery completed; DAVE is separately observed through a transition or voice privacy code.

If any required field fails, do not deploy the voice host on Cloudflare. Use the fallback section.

## 6. Deploy the private voice host

Set its bot token, control WebSocket URL, and agent keys through protected prompts:

```sh
pnpm secrets:voice-host
```

Export non-secret deployment flags, including `HOST_ENABLED=true`, then run:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
pnpm deploy:voice-host
```

The Worker has `workers_dev=false`, no route, and a one-minute reconciliation schedule. Confirm Container health and AgentSession heartbeats before running a voice command.

## 7. Conventional-host fallback

Copy `deploy/voice-agent.env.example` to ignored `deploy/voice-agent.env`, provide secrets through the host's secret manager, build the image, and run:

```sh
docker compose -f deploy/docker-compose.yml up -d --build voice-agent
```

For systemd, install the repository under `/opt/discord-voice-control-plane`, install `deploy/discord-voice-agent.service`, prebuild the image, and enable the service. The agent still authenticates to the same Cloudflare control Worker.

## 8. Test and target rollout

Complete every row in `TEST_EVIDENCE.md` in `VC Control Lab`. Only then request Socialize staff authorization using the supplied form. Keep target results `UNVERIFIED` until observed during the approved window.
