# Project decisions

These decisions come from the approved implementation plan. A later change requires an explicit project decision; it cannot silently weaken the safety boundary.

- Repository: public MIT project `slaveofsolace/discord-voice-control-plane`; publish completed work on `main`. A temporary implementation branch may exist only long enough to preserve review history and must be deleted after a verified fast-forward.
- Deployment shape: one tenant and one deployment for the first proof, with isolation fields retained for later hosted use.
- Discord shape: interaction-only `VC Control` application and official `Voice Rooms` bot in `VC Control Lab`.
- Setup ownership: the owner delegates ordinary already-authenticated Discord UI navigation and inspection to Computer control. CAPTCHA, login or MFA, credential display or copying, privileged-intent changes, and permission confirmations remain manual owner actions.
- Public defaults: slash commands on; prefixes and managed rooms off.
- Private proof: prefixes may be enabled only with Message Content enabled in both configuration and Discord's portal.
- Target boundary: `/vc join` uses only the stored authorized target; third-party temporary rooms are presence-only.
- Hosting: Cloudflare control plane is retained; Cloudflare voice hosting is accepted only after the live Container probe. Docker Compose/systemd is the fallback.
- Billing: the user alone enables Workers Paid. No billing action is automated.
- Discord UI: ordinary setup may be automated when already authenticated; login, MFA, CAPTCHA, security prompts, permission confirmations, and credential display or copying remain manual.
- Socialize: staff approval and exact target IDs are required. No third-party commands, synthetic activity, or channel management.
- Target feasibility: the user confirmed that an official bot installation is not available in Socialize. Treat that constraint as authoritative; do not keep presenting a `MANAGE_GUILD` installer as the target solution.
- Authorized user path: the optional target adapter may use only Discord's documented local RPC interface after Discord partner/tester access and explicit OAuth authorization. It never accepts a raw user token, drives Discord UI, opens a user Gateway, sends audio, or sends a message as the user.
- Account profiles: begin with the user's currently authorized desktop account and bind it to the authenticated user ID. A later separate Discord account uses a separately authorized local profile without code or Cloudflare changes.
- Local draft boundary: RPC relay selects the exact authorized text channel and stages sanitized text locally. The receipt says `USER_SEND_REQUIRED`; only the user performs the final Discord send.
- Evidence: unit, integration, live test-guild, and target-guild labels are separate. Unobserved behavior stays `UNVERIFIED` or `BLOCKED`.
- Branch hygiene: inspect exact local and remote refs before deletion. Delete only task branches proven redundant with `main`; do not infer that an unrelated branch is stale.
