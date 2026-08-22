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

The installing person must currently hold Manage Server (`MANAGE_GUILD`) or Administrator in the selected guild. A moderator or staff role without that effective permission cannot complete Discord's server-install consent. That person may be different from the day-to-day operator and only needs to perform the one-time OAuth2 guild install. The optional Discord-approved local RPC adapter in section 7 is a distinct desktop deployment, not a bot-install bypass.

For an existing third-party room, set `VOICE_INSTALL_PROFILE=presence-only`, the exact approved application and guild IDs, and run `pnpm install:url:voice`. Give the generated ignored shortcut only to the named installer from the authorization record. The shortcut locks the guild picker and requests only `applications.commands`, `bot`, and the four presence permissions.

Ordinary already-authenticated portal setup may use authorized Computer control. Stop for login, MFA, CAPTCHA, security or privacy prompts, permission confirmation, client-secret display, or bot-token display. The user completes those steps.

Current live checkpoint: authorized Computer control created the private `VC Control Lab` server, `voice-control`, `voice-probe`, and both applications. Discord confirmed VC Control's lab install. Voice Rooms is staged at the final exact seven-permission consent. Public application identifiers are retained only in an ignored local runtime file. Credential display, privileged-intent changes, and permission grants remain protected action-time steps.

On Windows, run `pnpm secrets:local` before revealing either protected credential. The script first creates an ignored `.runtime/secrets` directory with access restricted to the current Windows account, then prompts without echo and writes the Voice Rooms bot token and VC Control client secret to `.runtime/secrets/discord.env`. It prints only the local path. Run a trusted repository command with `pnpm with:local-discord-secrets -- <command>` when those two environment variables are required. The wrapper does not print their values.

Record application, guild, channel, user, and role IDs in a local ignored environment file. Do not commit them as deployment facts.

## 3. Deploy the control Worker

Wrangler's D1 binding is ID-free in the committed config. Generated account and database IDs remain untracked.

If Wrangler can access more than one account, set `CLOUDFLARE_ACCOUNT_ID` in the invoking process before any secret or deployment command. Keep the selected value in an ignored local runtime file, not in Wrangler configuration or Git. A read-only `wrangler whoami` check must match the intended paid account before proceeding. The current private checkpoint matched the paid account, found no existing project Worker or Container, and found no project-named D1 collision.

Set required secrets through protected prompts:

```sh
pnpm secrets:control
```

For an automated first deployment, place the same values in an ignored, user-only `.env` file and set `DEPLOY_SECRETS_FILE` to its absolute path. Wrangler uploads that file alongside the code. Both Worker configurations declare their required secret names, so deployment fails closed if a required value is absent. Never commit or log the file.

During a planned HMAC rotation, add the previous secret through a separate explicit prompt:

```sh
pnpm secrets:control -- --include-previous
```

Set `AGENT_PREVIOUS_KEY_ID` only when its matching previous secret exists. Export the non-secret allowlist variables from `.env.example`.

For the first D1 auto-provisioning deployment only:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
set INITIAL_D1_PROVISION=true
set DEPLOY_SECRETS_FILE=C:\path\outside-git\control.env
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

Set `TARGET_APPROVER_USER_IDS` to the exact staff IDs allowed to run `authorize-target` without broader guild administration. The other `/voice-admin` subcommands still require Manage Channels. The command is intentionally registered without a blanket Discord `default_member_permissions` value because that field cannot represent the exact user allowlist; the bot enforces each subcommand at runtime.

## 5. Cloudflare Container gate

Workers Paid is active on the selected personal Cloudflare account. The account ID and billing data stay outside the repository. No script in this repository performs a billing action.

The probe is a separately named Container controlled by the private voice-host Worker. It does not have a public route, a separate Worker secret, or a second copy of the bot token.
The host schema rejects production and probe mode when both are enabled; run the probe with `HOST_ENABLED=false`, then disable the probe before enabling the production agent.

1. Set the voice-host bot token and agent key with `pnpm secrets:voice-host`.
   For an automated deployment, set `DEPLOY_SECRETS_FILE` to an ignored, user-only file containing those two values instead.
2. Export the exact private test guild and voice channel IDs, set `HOST_ENABLED=false`, and set `PROBE_ENABLED=true`.
3. Set `DEPLOY_APPROVED=discord-voice-control-plane` and run `pnpm deploy:voice-host`.
4. Follow sanitized `cloudflare_voice_probe_result`, `cloudflare_voice_probe_shutdown`, `cloudflare_voice_probe_lifecycle`, and `voice_host_probe_cycle_complete` events.
5. Let the one-minute voice-host cron call the named probe Container. Container `sleepAfter` is five minutes and the controller renews activity during a run.
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

If the operator machine has no Docker-compatible CLI, first set both host modes false and `CONTAINERS_ROLLOUT=none`, then run `pnpm deploy:voice-host` to create the private Worker without publishing an image. Connect that Worker to this repository through Cloudflare Workers Builds. Keep the production branch on `main`, remove `CONTAINERS_ROLLOUT`, and use the full deployment script so Cloudflare's build environment publishes both Dockerfile images. Runtime secrets remain Worker secrets; build variables contain only the non-secret deployment configuration. A successful build does not replace the live probe.

## 6. Deploy the private voice host

`CONTROL_AGENT_WS_URL` is a non-secret `wss://` deployment variable. If step 5 did not already set them, set the bot token and current agent key through protected prompts:

```sh
pnpm secrets:voice-host
```

During rotation only:

```sh
pnpm secrets:voice-host -- --include-previous
```

Export `CONTROL_AGENT_WS_URL`, `HOST_ENABLED=true`, `PROBE_ENABLED=false`, the tenant/deployment IDs, feature flags, `MANAGED_GUILD_IDS`, and the current key ID. Set a previous key ID only with its matching secret. Then run:

```sh
set DEPLOY_APPROVED=discord-voice-control-plane
pnpm deploy:voice-host
```

The Worker has `workers_dev=false`, no route, a one-minute reconciliation schedule, and one named Container per deployment. Its two-minute `sleepAfter` is renewed by scheduled reconciliation while hosting is enabled. Confirm Container health and a server-received AgentSession heartbeat younger than 45 seconds before issuing a voice command.

## 7. Optional authorized local RPC adapter

This adapter runs only on Windows beside the authenticated Discord desktop client. It is not deployed to Cloudflare Containers and does not use a Discord user token. Before setup, Discord must grant RPC partner access or put the selected user on the application's tester list. Register the configured redirect URI in the application.

Set the non-secret application ID, redirect URI, one allowed target guild ID, and profile name in the local process. Supply the application client secret through the existing protected local wrapper or another user-only secret manager. The first profile may be named `main`:

```text
set USER_RPC_PROFILE=main
set USER_RPC_DISCORD_APPLICATION_ID=<approved application snowflake>
set USER_RPC_DISCORD_REDIRECT_URI=<registered redirect URI>
set USER_RPC_ALLOWED_GUILD_ID=<staff-approved guild snowflake>
pnpm with:local-discord-secrets -- pnpm user-rpc:authorize
```

Discord opens its own RPC authorization dialog. Review and approve it manually. The script exchanges the returned OAuth code, authenticates the current desktop user, and writes a user-only ignored profile. It never requests or stores a raw Discord user token. Existing profile files are not overwritten during authorization.

Start the agent only after setting the normal deployment, tenant, WebSocket, and agent-key environment values:

```text
set USER_RPC_PROFILE=main
pnpm with:user-rpc-profile -- pnpm --filter @discord-vc-control/user-rpc-agent start
```

The wrapper refreshes the OAuth token when needed and injects the profile into only that child process. Startup fails if the desktop user differs from the profile's recorded user ID or if the authorized target differs from its one allowed guild. To migrate to a separate Discord account later, sign the Discord desktop client into that account and repeat authorization with a new profile name such as `presence`; do not overwrite or rename the original profile.

RPC `join`, `leave`, `status`, `diagnostics`, `pause`, `resume`, and `reconnect` operate on the exact stored target. The adapter never force-moves a user out of another voice channel. `relay` selects the exact authorized text channel and stages the sanitized text on the local clipboard, returning `USER_SEND_REQUIRED`; the user performs the final paste/send. Discord RPC provides no supported guild send-message or microphone-injection command.

## 8. Conventional-host fallback

Create a root-owned mode-0600 environment file outside the repository, provide secrets through the host's secret manager, and retain the same exact `MANAGED_GUILD_IDS` and `CONTROL_AGENT_WS_URL` values. Set `VOICE_AGENT_ENV_FILE` to that absolute path. The ignored `deploy/voice-agent.env` path is available only as a local fallback and is excluded from both Git and Docker build contexts. Build and run:

```sh
export VOICE_AGENT_ENV_FILE=/etc/discord-voice-control-plane/voice-agent.env
docker compose -f deploy/docker-compose.yml up -d --build voice-agent
```

For systemd, install the repository under `/opt/discord-voice-control-plane`, install `deploy/discord-voice-agent.service`, prebuild the image, and enable the service. The agent still authenticates to the same Cloudflare control Worker. The fallback does not expand its Discord permissions or target authorization.

## 9. Test and target rollout

Complete every official-bot row in `TEST_EVIDENCE.md` in `VC Control Lab`, including restart, clean SIGTERM, moderator removal, ACL preservation, and relay redelivery. Separately prove RPC approval, profile binding, exact voice selection, unexpected-disconnect blocking, desktop restart behavior, and the manual-send draft receipt before Socialize. Keep target results `UNVERIFIED` until observed during the approved window.
