# Privacy

The system does not subscribe to Discord voice receivers, inspect voice packets, record or transcribe speech, generate audio, or report member speech activity.

Cloudflare relay audit records contain a SHA-256 content hash, character length, actor and source IDs, timestamps, status, and result code. They never contain relay text, attachments, embeds, webhook payloads, or a target message ID for the manual user path. Signed command transit may hold sanitized content for up to 30 seconds while delivering it to the connected local agent.

Pending content is encrypted locally with AES-256-GCM and a random per-profile key beneath ignored, user-only runtime storage. The queue holds at most 50 nonterminal requests for 30 minutes. Terminal states purge full content and retain only redacted status metadata. Atomic current and backup files support restart recovery.

Preparing a request writes the bounded draft to the local Windows clipboard. The owner controls when it is pasted, sent, replaced, or cleared. `OWNER_CONFIRMED_SENT` records the owner's statement and does not prove Discord delivery.

RPC OAuth profiles contain access and refresh tokens, a client secret, application and user binding, redirect URI, and allowed guild. They never leave the local protected profile boundary. A separate account requires a separate named profile, key, and queue.

D1 audit records expire after 30 days by default; command receipts expire after 24 hours. Raw execution logs and private setup artifacts remain under ignored `.runtime`. Socialize contains no project bot, target authorization, or observed data.
