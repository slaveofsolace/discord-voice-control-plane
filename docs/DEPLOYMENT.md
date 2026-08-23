# Deployment

Deployment changes Discord applications, Cloudflare Workers, D1, Durable Objects, and local OAuth state. Use `VC Control Lab` first. Socialize is not a deployment target until the staff intake is complete.

## 1. Local release gate

Use Node 24 and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm security:secrets
pnpm security:dependencies
```

Run the Human Cortex ledger validator, anti-AI wording scan, `git diff --check`, and the diff-focused security review before publishing. Docker image construction may run in CI when Docker is unavailable locally; it is not live voice evidence.

## 2. Protected Discord setup

The private server is `VC Control Lab`, with `voice-control` and `voice-probe`.

- Install `VC Control` with `applications.commands` only and no bot.
- Install `Voice Rooms` only in the private server with View Channel, Connect, Send Messages, and Read Message History.
- Enable Message Content only for this private relay instance.
- Do not install Voice Rooms in Socialize.

Stop for login, MFA, CAPTCHA, credential display/copying, privileged-intent changes, OAuth approval, and permission confirmation. Those are owner actions.

On Windows, `pnpm secrets:local` creates an ignored, current-user directory and prompts without echo for protected Discord credentials. Use `pnpm with:local-discord-secrets -- <command>` to inject them into a trusted child process. Do not print or commit the resulting files.

## 3. Private relay configuration

Set these non-secret values in ignored deployment configuration:

```text
CONTROL_RELAY_ENABLED=true
CONTROL_RELAY_ONLY=true
CONTROL_RELAY_APPLICATION_ID=<Voice Rooms application>
CONTROL_GUILD_ID=<VC Control Lab>
CONTROL_RELAY_CHANNEL_ID=<locked relay channel>
CONTROL_OPERATOR_USER_IDS=<chosen operators>
CONTROL_OPERATOR_ROLE_IDS=<optional operator roles>
CONTROL_ELEVATED_USER_IDS=<chosen elevated operators>
CONTROL_ELEVATED_ROLE_IDS=<optional elevated roles>
MESSAGE_CONTENT_INTENT_ENABLED=true
PREFIX_COMMANDS_ENABLED=false
MANAGED_ROOMS_ENABLED=false
```

Relay-only mode is mandatory for this product path. It keeps Voice Rooms out of AgentSession so the local RPC client remains the sole authorized user-presence agent.

Set `RELAY_INGRESS_ENDPOINT` to the control Worker `/internal/relay-ingress` route. Store `RELAY_INGRESS_HMAC_SECRET` independently in the control and private Voice Rooms secret scopes. Never put it in tracked Wrangler configuration.

## 4. Control Worker and D1

Committed Wrangler configuration is account-neutral and uses ID-free D1 provisioning. Keep generated account and database IDs out of Git. Verify `wrangler whoami` matches the intended paid account before any write.

Set protected secrets:

```sh
pnpm secrets:control
```

For first provisioning:

```bat
set DEPLOY_APPROVED=discord-voice-control-plane
set INITIAL_D1_PROVISION=true
set DEPLOY_SECRETS_FILE=C:\path\outside-git\control.env
pnpm deploy:control
```

Later deployments leave `INITIAL_D1_PROVISION` unset so migrations run before the new version.

Set Discord's Interaction Endpoint URL to `https://<control-worker>/discord/interactions`. Register `/vc` with `pnpm commands:control` using a short-lived client-credentials token outside the Worker.

Do not deploy a placeholder ingress secret or weaken an allowlist to make setup pass.

## 5. Local RPC profile

The local agent requires the official Discord desktop client and Discord RPC partner/tester access. It cannot run headlessly in Cloudflare.

Create `main` while Discord desktop is signed into the intended account:

```bat
set USER_RPC_PROFILE=main
set USER_RPC_DISCORD_APPLICATION_ID=<approved application>
set USER_RPC_DISCORD_REDIRECT_URI=<registered redirect>
set USER_RPC_ALLOWED_GUILD_ID=<authorized guild>
pnpm with:local-discord-secrets -- pnpm user-rpc:authorize
```

Approve Discord's OAuth dialog manually. The authorizer refuses to overwrite an existing profile. A user statement such as “auth granted” is not profile proof; verification requires a profile-bound RPC authentication with the expected user and target.

Start the agent with deployment, WebSocket, and agent-key configuration present:

```bat
set USER_RPC_PROFILE=main
pnpm build
pnpm with:user-rpc-profile -- pnpm --filter @discord-vc-control/user-rpc-agent start
```

The process prints the loopback queue URL and protected runtime paths without printing secret values. A future `presence` account requires signing Discord desktop into that account and authorizing a new profile name. Never rename, copy over, or overwrite `main`.

## 6. Approval queue acceptance

Before enabling private ingress, prove locally:

1. The exact OAuth user, guild, voice target, and text target match.
2. Join and leave `voice-probe` through RPC without forcing a move from another channel.
3. Queue ordinary text and both operator and elevated command classes.
4. Verify wrong guild/channel/operator/role and elevated denials.
5. Verify status and cancel controls reveal no content.
6. Restart the local agent and Discord desktop; encrypted pending state recovers and wrong-account state blocks.
7. Have the owner choose **Prepare in Discord**, manually paste and send one approved test, then mark it sent.
8. Record preparation, owner confirmation, and independent Discord delivery as separate evidence.

Do not install user-logon startup until this matrix passes. Any later startup must remain an interactive-user process after Discord desktop, not a service.

## 7. Voice-host and Container proof

The Cloudflare private voice-host path remains available for reusable official-bot hosting. It has no public route and is the only Worker with the bot token.

Run the isolated probe before production voice hosting. Two distinct runs must prove DNS, HTTPS, Gateway, UDP discovery send/receive, Discord IP discovery, DAVE negotiation and renegotiation, stable silent connection, controlled recovery, native compatibility, no inbound UDP listener dependency, clean SIGTERM, and lifecycle restart. An image build or health endpoint is insufficient.

If any UDP, DAVE, native, restart, or lifecycle gate fails, retain the Cloudflare control plane and use the Docker Compose/systemd fallback documented in the hosting ADR. This probe is separate from the local RPC user path.

## 8. Rollout and rollback

Exercise command disablement, emergency disconnect, Worker rollback, D1 compensating migration/PITR procedure, OAuth revocation, ingress and agent key rotation, dashboard/profile recovery, audit purge, and local process shutdown in the private environment.

Push only green, reviewable commits to `main`, then watch GitHub Actions for that exact SHA. A successful CI run is source and construction evidence, not live Discord evidence.

## 9. Socialize gate

Socialize remains untouched and `BLOCKED`. Before any target action, staff must provide an approval reference and window, the exact guild/voice/text targets, the named RPC account and operators, incident/removal contacts, and a supported persistent-room or timeout-exemption mechanism.

No project bot is installed there. No third-party command, managed-room operation, automatic user message, synthetic audio, or scheduled activity is permitted. If approved passive observation shows normal authorized-member presence does not retain the room and staff provides no supported configuration, record:

`TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM`
