# Architecture

## Runtime boundaries

```text
Private control server
  operator message
       |
       v
Voice Rooms (relay-only bot)
       |
       v  ingress HMAC + timestamp + nonce
Control Worker ---- D1 redacted audit/config
       |
       v  signed 30-second command
AgentSession Durable Object
       |
       v
Windows user RPC agent ---- Discord desktop IPC/OAuth
       |
       +---- encrypted per-profile approval queue
       +---- 127.0.0.1 dashboard
       +---- exact voice/text selection
       +---- clip.exe preparation
                       |
                       v
                 owner pastes and sends
```

`VC Control` remains an interaction-only Discord application. The Worker verifies Discord's Ed25519 signature over the raw request before parsing, then checks the application, guild, channel, user, role, and elevated allowlists. It has no bot token, user OAuth credential, or Gateway connection.

`Voice Rooms` is installed only in the private control server for this deployment. `CONTROL_RELAY_ONLY=true` prevents its Gateway process from opening an AgentSession connection, and the voice-host Worker omits agent-authentication credentials from that bot Container. It cannot replace or impersonate the local RPC agent. It accepts only new human messages from the exact configured relay channel and forwards sanitized requests through the dedicated ingress. Managed rooms and prefix handling remain reusable code paths, but they are off in relay-only mode.

The relay ingress has its own HMAC secret. It verifies the raw body, a 30-second timestamp window, a unique nonce, tenant, deployment, application, guild, channel, source message, actor, roles, and grammar. A deterministic request ID derived from deployment, application, and source message makes Gateway reconnect delivery idempotent. The Worker checks that the authorized local RPC agent is connected before accepting content. Cloudflare stores only hash, length, source IDs, actor, status, timestamps, and result code.

`AgentSession` is one SQLite-backed Durable Object per deployment. It stores desired and observed state, signed-command replay nonces, pending/executing commands, receipts, relay metadata, heartbeats, and recovery outboxes. The signed agent command envelope retains its 30-second expiry, current/previous HMAC keys, five-minute nonce replay window, and 24-hour receipts. Content exists in transit only until the local agent accepts or rejects the command.

The local agent uses Discord's documented IPC RPC and OAuth profile. It verifies the authenticated Discord user, exact guild, exact voice target, and exact text target. It never receives a raw user token and never opens a user Gateway. Discord desktop must remain signed into the expected account.

## Local approval boundary

A relay command has no immediate clipboard or Discord side effect. The agent writes it to a per-profile encrypted queue and returns `PENDING_USER_APPROVAL`. Queue content uses AES-256-GCM with a random profile key under ignored, user-only runtime storage. Atomic current, temporary, and backup files provide restart recovery. The queue holds at most 50 nonterminal requests for 30 minutes and displays them FIFO.

The loopback dashboard binds only to `127.0.0.1`. It enforces a generated profile-bound session secret, exact Host and Origin, SameSite cookies, CSRF tokens, CSP, no CORS, no remote assets, and bounded request bodies.

`Prepare in Discord` rechecks the OAuth identity, profile, target authorization, RPC connection, selected voice channel, request age, and state. It selects the exact authorized text channel and writes the bounded draft with `C:\Windows\System32\clip.exe`. It never pastes, presses Enter, drives Discord UI, or calls an undocumented send endpoint.

The owner manually pastes and sends. `OWNER_CONFIRMED_SENT` records only the owner's statement; it is not a Discord delivery receipt and never has a `target_message_id`. Terminal states purge full content.

## Profiles and targets

The initial profile is `main`. A future `presence` profile has a separate file, encryption key, queue, OAuth grant, and expected Discord user ID. Profiles are never renamed or overwritten. One deployment admits one active profile. A profile or target-authorization change invalidates every nonterminal request.

The agent fails closed when Discord desktop is absent, RPC access is unavailable, OAuth refresh fails, the signed-in user differs, the target differs, the user is already in another voice channel, or Discord/moderation moves or disconnects the user.

## Managed rooms and official-bot voice

The reusable official-bot path retains managed-room setup, one room per human owner, ACL preservation, 15-second zero-human cleanup, DAVE-gated silent voice state, bounded transient recovery, and presence-only external targets. It never records, receives, transcribes, or emits audio. That path is not the Socialize target and is not installed there.
