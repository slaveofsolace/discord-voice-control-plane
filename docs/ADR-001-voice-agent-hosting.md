# ADR 001: voice-agent hosting

Status: accepted with a live gate.

## Decision

Use Cloudflare for the HTTP control plane. Attempt the official Voice Rooms Gateway and voice process in a private Cloudflare Container only after the dedicated probe passes on the selected account.

The probe must produce two complete reports with different run IDs. Each report must observe outbound DNS and HTTPS, a Discord Gateway WebSocket hello, an authenticated bot Gateway session, a fresh authenticated Gateway client after recovery, Discord UDP discovery, voice ready, DAVE negotiation, DAVE renegotiation after controlled voice rejoin, stable silent connections, the pinned native stack, and no inbound UDP listener or audio path. Both controlled stops must produce clean SIGTERM evidence before the controller records lifecycle restart as verified.

If any UDP, DAVE, lifecycle, native dependency, or restart check fails, retain the Cloudflare control Worker and run the same image through the Docker Compose/systemd adapter on an authorized conventional host.

## Reason

Cloudflare is the chosen control platform, but a generic image build or HTTP health response cannot establish Discord voice compatibility. Separating the probe prevents an untested hosting assumption from becoming a deployment claim.

## Consequences

- Workers Paid must be enabled manually before Container deployment.
- The bot token remains outside the control Worker in both hosting modes.
- Container `sleepAfter` is managed by scheduled controller activity and must be observed live rather than inferred from configuration.
- Live labels stay `BLOCKED` or `UNVERIFIED` until sanitized probe evidence exists.
- Rollback must account for both Worker version and Container image revision.
