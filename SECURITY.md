# Security policy

Do not open a public issue containing a Discord token, client secret, Cloudflare credential, HMAC key, interaction token, private guild ID, or raw audit/log output.

Report a suspected vulnerability privately through GitHub's security advisory flow for this repository. Include affected commit, preconditions, impact, and a minimal reproduction with dummy identifiers.

Supported code is the latest commit on `main`. Publication on `main` does not imply that Discord or Cloudflare live gates have passed; consult `docs/TEST_EVIDENCE.md` for the current evidence boundary.

If a credential may have leaked:

1. Disable control commands and disconnect the voice bot.
2. Rotate the Discord bot token or application secret in Discord's portal.
3. Rotate the current agent HMAC key while temporarily retaining the previous key only for the planned overlap.
4. Replace Cloudflare secrets through protected prompts.
5. Purge exposed runtime logs and audit rows according to policy.
6. Review Git history and GitHub secret-scanning alerts before restoring service.

Never submit real credentials in a test fixture or reproduction.
