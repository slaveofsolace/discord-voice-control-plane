# Project decisions

These project decisions are authoritative until the owner explicitly changes them.

- Publish the reusable MIT repository on `main`; use focused commits and push only after all local gates pass.
- V1 is one tenant and one deployment, with isolation fields retained for later hosted use.
- `VC Control` is interaction-only. `Voice Rooms` is installed only in the private control server and runs relay-only for the authorized user path.
- The OAuth-authorized Discord desktop account, not Voice Rooms, supplies target voice presence through documented local RPC.
- Begin with a profile named `main`. A later `presence` account requires a separate file, key, queue, expected user ID, and fresh manual OAuth grant. Never overwrite or rename `main`.
- Operators submit ordinary messages through one exact locked relay channel. Elevated commands require separate user or role allowlists and a prominent risk label.
- The private bot queues requests but cannot make the normal account send. The owner performs the final paste and send. `OWNER_CONFIRMED_SENT` is a human receipt, not verified delivery.
- Cloudflare verifies a separate relay-ingress HMAC and keeps only redacted relay metadata. Full pending content exists only in the encrypted local queue.
- Public defaults are slash-command-only. Prefixes, Message Content, relay intake, and managed rooms fail closed unless explicitly configured. Relay-only mode forbids managed rooms and prefix handling.
- No raw user token, user Gateway, automatic user-account message, Discord UI keystroke, synthetic audio, scheduled activity, or anti-AFK claim is allowed.
- Login, MFA, CAPTCHA, credential display or copying, privileged-intent changes, permission grants, and OAuth approval remain manual owner actions.
- User-logon startup is not installed until the private-lab acceptance matrix passes.
- Socialize is untouched. Staff must provide an approved window, exact targets, contacts, and a supported persistent-room or timeout-exemption mechanism before any target action.
- Source tests, private-lab behavior, Cloudflare deployment, local RPC behavior, and target-guild behavior use separate evidence labels. Unobserved behavior stays `UNVERIFIED` or `BLOCKED`.
- Do not delete branches or perform unrelated repository cleanup during this delivery.
