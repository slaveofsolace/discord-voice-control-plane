# Security policy

Do not open a public issue containing a Discord token, OAuth access or refresh token, client secret, Cloudflare credential, HMAC key, interaction token, private guild ID, or raw audit/log output.

Report a suspected vulnerability privately through GitHub's security advisory flow for this repository. Include affected commit, preconditions, impact, and a minimal reproduction with dummy identifiers.

Supported code is the latest commit on `main`. Publication on `main` does not imply that Discord or Cloudflare live gates have passed; consult `docs/TEST_EVIDENCE.md` for the current evidence boundary.

If a credential may have leaked:

1. Disable control commands and disconnect the voice bot.
2. Rotate the Discord bot token or application secret in Discord's portal.
3. Revoke any affected local RPC OAuth grant and delete its ignored profile.
4. Rotate the current agent HMAC key while temporarily retaining the previous key only for the planned overlap.
5. Replace Cloudflare secrets through protected prompts.
6. Purge exposed runtime logs and audit rows according to policy.
7. Review Git history and GitHub secret-scanning alerts before restoring service.

Never submit real credentials in a test fixture or reproduction.

The conventional-host environment file belongs outside the repository and should be readable only by its service account. `deploy/voice-agent.env` is ignored as a local fallback and excluded from the deny-by-default Docker build context. The Cloudflare probe runs under the private voice-host Worker so the bot token is not copied into a second Worker secret boundary.

Local RPC profiles belong only under ignored `.runtime/secrets/user-rpc`. The profile directory is restricted to the current OS user. Never repurpose a raw Discord user token; the adapter accepts only Discord OAuth tokens returned by the documented local RPC authorization flow.
