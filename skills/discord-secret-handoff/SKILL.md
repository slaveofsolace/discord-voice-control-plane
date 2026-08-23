---
name: discord-secret-handoff
description: Coordinate protected local capture of Discord bot tokens and application client secrets without putting credential values in chat, logs, screenshots, clipboard inspection, or command history. Use when an official Discord application needs owner-supplied credentials. Do not use for user tokens, self-bots, or automated credential revelation.
---

# Discord Secret Handoff

Minimize the owner's credential work while preserving the account-security boundary. This skill can open the exact application page, prepare a hidden local prompt, verify the protected file, and resume API work. It cannot turn credential generation, revelation, copying, password entry, MFA, CAPTCHA, or OAuth/permission confirmation into an automated action.

## Establish the destination before opening Discord

- Confirm the official application ID, credential kind, exact local destination, and command that will consume it.
- Inspect the capture implementation before running it. Require a real TTY with echo disabled, bounded input, newline rejection, atomic creation, and an ignored user-only destination.
- On Windows, restrict the destination directory ACL to the current user. Never pass a secret in a process argument, URL, environment dump, shell history, source file, screenshot, or chat message.
- Refuse raw Discord user-account tokens. This workflow supports official bot tokens and application client secrets only.

## Prepare the handoff

1. Use authorized Computer control only to navigate an already-authenticated browser to the exact Discord Developer Portal application page.
2. Stop before **Reset Token**, **View/Reveal**, **Copy**, password, MFA, CAPTCHA, security prompts, OAuth approval, or permission confirmation. Do not capture another screenshot after a credential becomes visible.
3. Start the inspected capture command in an interactive TTY and expose that terminal to the owner. Leave it at the named hidden prompt.
4. Ask the owner for one atomic action: create or reveal the credential if necessary, copy it, paste it into the hidden terminal, and press Enter. Tell them never to paste it into chat.
5. Poll only for prompt progression or process completion. Never read the clipboard, inject secret text with Computer, send secret characters through a tool call, or inspect terminal input.

An instruction such as "do it yourself" authorizes the surrounding preparation and continuation; it does not remove the protected credential handoff.

## Verify without revealing

- Check only that the expected file exists, contains the expected key names, has non-empty values, and is excluded from version control. Do not print values, lengths precise enough to fingerprint them, hashes, prefixes, or suffixes.
- Check the destination ACL or mode and fail closed if it is broader than the current user.
- Consume credentials through the protected wrapper. Redact authorization headers and API responses before reporting failures.
- Verify the official bot identity, application identity, and authorized guild through documented Discord APIs. Report IDs only when they are already non-secret project configuration.
- Record `credential_present=true` or an equivalent boolean, never the credential.

## Failure and recovery

- If the prompt is cancelled or incomplete, do not deploy and do not create placeholder credentials.
- If a destination already exists, stop instead of overwriting it. Rotate only through a fresh owner-approved Discord flow, then replace the local file through an explicit recovery procedure.
- If identity or guild verification fails, preserve the file, suppress its contents, and report the exact non-secret result code.
- Resume command registration, deployment, or testing only after protected capture and identity checks pass.
