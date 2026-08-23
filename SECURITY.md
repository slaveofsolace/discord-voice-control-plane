# Security policy

Report vulnerabilities privately through this repository's GitHub security advisory flow. Include the affected commit, preconditions, impact, and a minimal reproduction with dummy identifiers.

Never publish a Discord bot token, OAuth access or refresh token, client secret, Cloudflare credential, HMAC key, interaction token, dashboard secret, private guild ID, queue file, or raw audit/log output.

Publication on `main` does not imply that live Discord or Cloudflare gates passed. Consult `docs/TEST_EVIDENCE.md`.

## Credential response

1. Disable control and relay intake.
2. Disconnect the selected agent.
3. Rotate the affected bot, application, ingress, agent, dashboard, or Cloudflare credential.
4. Revoke the affected local RPC OAuth grant and remove only that named profile after preserving incident evidence.
5. Purge exposed runtime files and audit rows according to policy.
6. Review Git history and GitHub secret-scanning alerts before restoring service.

Local RPC profiles, approval queues, dashboard secrets, and encryption keys belong only beneath ignored `.runtime/secrets/user-rpc` with current-user filesystem access. The adapter accepts OAuth tokens returned by Discord's documented local RPC flow; it never accepts a raw Discord user token.

The dashboard binds only to `127.0.0.1` and requires exact Host and Origin, authenticated SameSite cookies, CSRF protection, CSP, no CORS, no remote assets, and bounded request bodies. Preparing a request uses only the fixed `C:\Windows\System32\clip.exe` path and does not paste or send.

The Cloudflare relay ingress has a separate HMAC secret, a 30-second freshness window, unique nonces, constant-time MAC verification, deterministic source-message idempotency, and exact tenant/deployment/application/guild/channel/actor validation. D1 receives relay metadata, never content.

Do not add user Gateway clients, raw user-token libraries, UI automation, send-message endpoints for the OAuth account, audio generation or capture, scheduled activity, or retention workarounds.
