# Final evidence report

Use exactly these ten sections. Replace placeholders only with sanitized evidence. Do not delete nonclaims.

## 1. Scope and outcome

Objective, delivered scope, and overall status.

## 2. Repository and review state

Repository URL, branch, commit IDs, draft PR, clean-tree result, and explicit no-merge statement.

## 3. Architecture delivered

Control Worker, AgentSession, D1, private host, voice agent, managed rooms, probe, and fallback adapter.

## 4. Security and authorization evidence

Signature, allowlist, HMAC, replay, idempotency, least privilege, redaction, secret scan, and unresolved risks.

## 5. Local and CI verification

Exact commands, pass/fail counts, dependency audit, image builds, and CI link. Label each result.

## 6. Private Discord verification

Application and guild setup, every command family, authorization failures, ACL preservation, cleanup, restart, and SIGTERM. Use `UNVERIFIED` for any missing row.

## 7. Cloudflare deployment and voice proof

Control URL, D1 and Durable Object state, Container revision, two probe run IDs, DNS/HTTPS/Gateway/UDP/DAVE/stability/recovery evidence, or exact blocker.

## 8. Socialize authorization and target result

Staff approval reference, exact target, approved window, presence-only actions, observed deletion timing, and `TARGET RETENTION BLOCKED — NO SUPPORTED PERSISTENCE MECHANISM` when applicable.

## 9. Privacy, operations, and rollback

Data retained, retention/purge, emergency disconnect, app removal, Worker/Container rollback, D1 compensation/PITR, bot-token rotation, and agent-key rotation.

## 10. Blockers and next atomic action

List every `BLOCKED` or `UNVERIFIED` claim and one safe next action. State that the draft PR was not merged.
