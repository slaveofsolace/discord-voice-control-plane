# Research record

Checked on 2026-08-22.

## Discord

- Discord application commands do not require a bot user in a guild. Discord also permits command registration with a client-credentials token carrying `applications.commands.update`. This is why VC Control has no bot token or Gateway process. Source: [Application Commands](https://docs.discord.com/developers/interactions/application-commands).
- HTTP interactions must be signature-verified and initially answered within three seconds. The control Worker verifies the untouched body before JSON parsing and defers work that may exceed that window. Source: [Receiving and Responding to Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding).
- Message Content is a privileged intent. The public template keeps prefixes off; the private deployment must enable both the feature flag and the portal intent before using `!voice` or `!v`. Source: [Gateway Intents](https://docs.discord.com/developers/events/gateway).
- `@discordjs/voice` 0.19.2 includes the DAVE library through `@snazzah/davey`. The lockfile pins both versions. Source: [discord.js voice documentation](https://discord.js.org/docs/packages/voice/stable).
- Discord's create-message endpoint supports a client nonce with `enforce_nonce`; relay uses both so a repeated request cannot create a second message with the same nonce. Source: [Discord message resource](https://docs.discord.com/developers/resources/message).
- The voice library exposes supported disconnect and rejoin operations. The probe uses those operations and requires a second DAVE observation after rejoin. Source: [VoiceConnection](https://discord.js.org/docs/packages/voice/main/VoiceConnection%3AClass).

## Cloudflare

- New Wrangler projects use `wrangler.jsonc`; a D1 binding without an ID can be provisioned by Wrangler. The committed configs contain no account ID or database ID. Source: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).
- Container-backed Durable Objects must use `new_sqlite_classes`. The private host config registers separate production-agent and probe classes through that migration form. Source: [Containers getting started](https://developers.cloudflare.com/containers/get-started/).
- `startAndWaitForPorts`, `getState`, `stop`, and named `getContainer` routing are the current lifecycle API used by the host Worker. Source: [Container interface](https://developers.cloudflare.com/containers/container-class/).
- Container inactivity is controlled by `sleepAfter`, while cron triggers can keep a named controller active. The private host uses one schedule to reconcile either named Container and still requires live lifecycle evidence. Sources: [Container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/) and [Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- A Container image build is not voice acceptance. The committed probe requires live DNS, HTTPS, Gateway WebSocket, Discord UDP discovery, DAVE, a stable silent connection, reconnect, and two different Container run IDs.

## Unresolved live facts

- Authenticated account UI now shows Workers Paid as the current plan and Containers included. This resolves the billing prerequisite but does not prove deployment, UDP, DAVE, or lifecycle behavior. No account ID or billing detail is stored in this repository.
- A prior read-only `wrangler containers list` check failed before enrollment because Containers required Workers Paid. That historical result is superseded for account-plan status and must be rerun as deployment preflight.
- The updated authorized Computer component is functional. Authenticated live UI created the private `VC Control Lab` server, `voice-control`, and `voice-probe` without creating an invite or adding another member.
- `VC Control` is prefilled and the developer terms box is selected in Discord's new-application dialog, but Create was not pressed. Neither Discord application identity has been created, and no client secret, bot token, privileged intent, installation grant, registered command, Gateway session, or voice session has been observed.
- No Discord Gateway, UDP discovery, DAVE session, test-guild command, or Socialize result has been observed.
- Socialize is `BLOCKED` because staff approval, an approved window, approved application and bot IDs, guild ID, and exact target ID have not been supplied. Deletion behavior remains `UNVERIFIED` until an authorized live observation.
