# ADR 0001: voice hosting

Status: accepted with a live gate.

## Decision

Use Cloudflare for the HTTP control plane. Attempt the official Voice Rooms Gateway and voice process in a private Cloudflare Container only after the dedicated probe passes on the selected account.

The probe must observe outbound DNS and HTTPS, a Discord Gateway WebSocket hello, an authenticated bot Gateway session, Discord UDP IP discovery, DAVE negotiation, a stable silent connection, explicit reconnect, SIGTERM, and two different Container run IDs. It exposes no UDP listener and sends no audio.

If any UDP, DAVE, lifecycle, native dependency, or restart check fails, retain the Cloudflare control Worker and run the same image through the Docker Compose/systemd adapter on an authorized conventional host.

## Reason

Cloudflare is already the chosen control platform, but a generic image build or HTTP health response cannot establish Discord voice compatibility. Separating the probe prevents an untested hosting assumption from becoming a deployment claim.

## Consequences

- Workers Paid must be enabled manually before Container deployment.
- The bot token remains outside the control Worker in both hosting modes.
- Live labels stay `BLOCKED` or `UNVERIFIED` until sanitized probe evidence exists.
- Rollback must account for both Worker version and Container image revision.
