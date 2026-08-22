# Privacy

The system does not subscribe to Discord voice receivers, inspect voice packets, record audio, transcribe speech, generate audio, or report member speech activity.

Relay audit records contain the normalized text's SHA-256 hash, character length, actor, result, time, and resulting Discord message ID. They do not contain relay text, attachments, embeds, or webhook data. `allowed_mentions.parse` is empty for every relay and command response.

An authenticated relay command necessarily carries the normalized text to the voice agent. While awaiting delivery, that signed envelope can exist in the deployment's Durable Object pending queue. Its expiry is 30 seconds; a Durable Object alarm deletes expired pending rows. The D1 audit and receipt tables never receive the relay text.

Configuration records contain Discord snowflake IDs needed for authorization, ownership, ACL restoration, and exact target routing. Audit records expire after 30 days by default. Command receipts expire after 24 hours. A scheduled Worker deletes expired records.

Raw local execution logs belong under ignored `.runtime/`. Before evidence is committed, remove tokens, secrets, interaction tokens, message text, account IDs that are not needed, and personal data.

Operators can disable commands, disconnect the bot, remove the applications, rotate tokens and agent keys, and purge retained audit records through the runbook.
